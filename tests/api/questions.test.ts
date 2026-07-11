import { beforeEach, describe, expect, it, vi } from "vitest";

// Internal ticket Q&A gates: schema-validated bodies, tenant-scoped lookups
// (foreign tickets/questions 404), assignee must be a tenant teammate, the
// status machine (open → answered on a teammate's reply, follow-ups keep it
// open, closed blocks replies), audit rows, and best-effort notifications.
// Email + base-url are mocked — nothing leaves this file.
const { prisma, sessionUser, getCurrentTenant, sendEmail, baseUrl } = vi.hoisted(() => ({
  prisma: {
    ticket: { findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
    ticketQuestion: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    ticketQuestionReply: { create: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  sessionUser: vi.fn(),
  getCurrentTenant: vi.fn(),
  sendEmail: vi.fn(),
  baseUrl: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/tenant", () => ({ getCurrentTenant }));
vi.mock("@/lib/roles", () => ({
  sessionUser,
  isAdminRole: (role: string | null | undefined) => role === "brand_admin" || role === "super_admin",
}));
vi.mock("@/lib/email", () => ({ sendEmail, escapeHtml: (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;") }));
vi.mock("@/lib/base-url", () => ({ baseUrl }));

const { POST: ASK } = await import("@/app/api/tickets/[id]/questions/route");
const { POST: REPLY } = await import("@/app/api/questions/[id]/replies/route");
const { PATCH: STATUS } = await import("@/app/api/questions/[id]/route");

const req = (url: string, method: string, body: unknown) =>
  new Request(`http://localhost:3014${url}`, { method, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentTenant.mockResolvedValue({ id: "t1", slug: "stingray" });
  sessionUser.mockResolvedValue({ id: "rep1", email: "rep@x.com", tenantId: "t1", role: "brand_admin" });
  prisma.auditEvent.create.mockResolvedValue({});
  sendEmail.mockResolvedValue(true);
  baseUrl.mockReturnValue("https://concierge.test");
});

describe("auth rejection (all question routes)", () => {
  it("401s every route when there is no session", async () => {
    sessionUser.mockResolvedValue(null);
    const ask = await ASK(req("/api/tickets/tk1/questions", "POST", { body: "Who can help?" }), params("tk1"));
    const reply = await REPLY(req("/api/questions/q1/replies", "POST", { body: "Me." }), params("q1"));
    const status = await STATUS(req("/api/questions/q1", "PATCH", { status: "closed" }), params("q1"));
    expect([ask.status, reply.status, status.status]).toEqual([401, 401, 401]);
    expect(prisma.ticketQuestion.create).not.toHaveBeenCalled();
    expect(prisma.ticketQuestionReply.create).not.toHaveBeenCalled();
    expect(prisma.ticketQuestion.update).not.toHaveBeenCalled();
  });
});

describe("POST /api/tickets/[id]/questions (ask)", () => {
  it("rejects a too-short question with 400 before touching the DB", async () => {
    const res = await ASK(req("/api/tickets/tk1/questions", "POST", { body: "hi" }), params("tk1"));
    expect(res.status).toBe(400);
    expect(prisma.ticket.findFirst).not.toHaveBeenCalled();
  });

  it("404s on a ticket outside the session tenant", async () => {
    prisma.ticket.findFirst.mockResolvedValue(null);
    const res = await ASK(req("/api/tickets/tk1/questions", "POST", { body: "Who can help with this?" }), params("tk1"));
    expect(res.status).toBe(404);
    expect(prisma.ticketQuestion.create).not.toHaveBeenCalled();
  });

  it("rejects an assignee from another tenant", async () => {
    prisma.ticket.findFirst.mockResolvedValue({ id: "tk1", subject: "Graphics", customer: { displayName: "Al" } });
    prisma.user.findFirst.mockResolvedValue(null); // scoped lookup finds nothing
    const res = await ASK(
      req("/api/tickets/tk1/questions", "POST", { body: "Who can help with this?", assigneeId: "intruder" }),
      params("tk1")
    );
    expect(res.status).toBe(400);
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: "intruder", tenantId: "t1" },
      select: { id: true, email: true, name: true },
    });
    expect(prisma.ticketQuestion.create).not.toHaveBeenCalled();
  });

  it("creates the question, audits, and emails the assignee a /qa link", async () => {
    prisma.ticket.findFirst.mockResolvedValue({ id: "tk1", subject: "Graphics", customer: { displayName: "Al" } });
    prisma.user.findFirst.mockResolvedValue({ id: "jim", email: "jim@x.com", name: "Jim P" });
    prisma.ticketQuestion.create.mockResolvedValue({ id: "q1" });
    const res = await ASK(
      req("/api/tickets/tk1/questions", "POST", { body: "Who can help with the flag graphic?", assigneeId: "jim" }),
      params("tk1")
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, questionId: "q1" });
    expect(prisma.ticketQuestion.create).toHaveBeenCalledWith({
      data: {
        tenantId: "t1",
        ticketId: "tk1",
        askedById: "rep1",
        assigneeId: "jim",
        body: "Who can help with the flag graphic?",
      },
    });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "question_asked", entity: "ticket:tk1", actorId: "rep1" }),
    });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["jim@x.com"],
        text: expect.stringContaining("https://concierge.test/tickets/tk1/qa"),
      })
    );
  });

  it("skips the email when the question is open to anyone", async () => {
    prisma.ticket.findFirst.mockResolvedValue({ id: "tk1", subject: "Graphics", customer: { displayName: "Al" } });
    prisma.ticketQuestion.create.mockResolvedValue({ id: "q1" });
    const res = await ASK(req("/api/tickets/tk1/questions", "POST", { body: "Anyone know this one?" }), params("tk1"));
    expect(res.status).toBe(200);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("escapes user text in the notification's HTML part", async () => {
    prisma.ticket.findFirst.mockResolvedValue({ id: "tk1", subject: "<b>Graphics</b>", customer: { displayName: "Al" } });
    prisma.user.findFirst.mockResolvedValue({ id: "jim", email: "jim@x.com", name: "Jim P" });
    prisma.ticketQuestion.create.mockResolvedValue({ id: "q1" });
    const res = await ASK(
      req("/api/tickets/tk1/questions", "POST", { body: 'Click <a href="https://evil.example">here</a>?', assigneeId: "jim" }),
      params("tk1")
    );
    expect(res.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const { html } = sendEmail.mock.calls[0][0];
    expect(html).not.toContain('<a href="https://evil.example">');
    expect(html).toContain("&lt;a href=&quot;https://evil.example&quot;&gt;");
    expect(html).toContain("&lt;b&gt;Graphics&lt;/b&gt;");
  });
});

describe("POST /api/questions/[id]/replies", () => {
  const question = {
    id: "q1",
    ticketId: "tk1",
    askedById: "rep1",
    status: "open",
    askedBy: { id: "rep1", email: "rep@x.com" },
    assignee: { id: "jim", email: "jim@x.com" },
    ticket: { id: "tk1", subject: "Graphics" },
  };

  it("404s on a question outside the session tenant", async () => {
    prisma.ticketQuestion.findFirst.mockResolvedValue(null);
    const res = await REPLY(req("/api/questions/q1/replies", "POST", { body: "It's Dave." }), params("q1"));
    expect(res.status).toBe(404);
  });

  it("400s on a closed question", async () => {
    prisma.ticketQuestion.findFirst.mockResolvedValue({ ...question, status: "closed" });
    const res = await REPLY(req("/api/questions/q1/replies", "POST", { body: "It's Dave." }), params("q1"));
    expect(res.status).toBe(400);
    expect(prisma.ticketQuestionReply.create).not.toHaveBeenCalled();
  });

  it("a teammate's answer flips the question to answered and notifies the asker", async () => {
    sessionUser.mockResolvedValue({ id: "jim", email: "jim@x.com", tenantId: "t1", role: "agent" });
    prisma.ticketQuestion.findFirst.mockResolvedValue(question);
    prisma.ticketQuestionReply.create.mockResolvedValue({ id: "r1" });
    const res = await REPLY(req("/api/questions/q1/replies", "POST", { body: "Dave at the graphics shop." }), params("q1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, replyId: "r1", status: "answered" });
    expect(prisma.ticketQuestion.update).toHaveBeenCalledWith({ where: { id: "q1" }, data: { status: "answered" } });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "question_answered" }),
    });
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: ["rep@x.com"] }));
  });

  it("the asker's follow-up keeps it open and notifies the assignee", async () => {
    prisma.ticketQuestion.findFirst.mockResolvedValue({ ...question, status: "answered" });
    prisma.ticketQuestionReply.create.mockResolvedValue({ id: "r2" });
    const res = await REPLY(req("/api/questions/q1/replies", "POST", { body: "And his number?" }), params("q1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, replyId: "r2", status: "open" });
    expect(prisma.ticketQuestion.update).toHaveBeenCalledWith({ where: { id: "q1" }, data: { status: "open" } });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "question_followed_up" }),
    });
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: ["jim@x.com"] }));
  });

  it("a same-status reply still updates the question, bumping updatedAt for the queue order", async () => {
    prisma.ticketQuestion.findFirst.mockResolvedValue(question); // already open, asker replying
    prisma.ticketQuestionReply.create.mockResolvedValue({ id: "r3" });
    const res = await REPLY(req("/api/questions/q1/replies", "POST", { body: "More context: 2007 200cx." }), params("q1"));
    expect(res.status).toBe(200);
    expect(prisma.ticketQuestion.update).toHaveBeenCalledWith({ where: { id: "q1" }, data: { status: "open" } });
  });
});

describe("PATCH /api/questions/[id] (close/reopen)", () => {
  it("rejects an unknown status with 400 before touching the DB", async () => {
    const res = await STATUS(req("/api/questions/q1", "PATCH", { status: "answered" }), params("q1")); // system-set
    expect(res.status).toBe(400);
    expect(prisma.ticketQuestion.findFirst).not.toHaveBeenCalled();
  });

  it("closes a question and audits (asker)", async () => {
    prisma.ticketQuestion.findFirst.mockResolvedValue({ id: "q1", ticketId: "tk1", tenantId: "t1", askedById: "rep1" });
    const res = await STATUS(req("/api/questions/q1", "PATCH", { status: "closed" }), params("q1"));
    expect(res.status).toBe(200);
    expect(prisma.ticketQuestion.update).toHaveBeenCalledWith({ where: { id: "q1" }, data: { status: "closed" } });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "question_closed", entity: "ticket:tk1" }),
    });
  });

  it("403s a non-asker non-admin — the asker-only rule lives server-side", async () => {
    sessionUser.mockResolvedValue({ id: "jim", email: "jim@x.com", tenantId: "t1", role: "agent" });
    prisma.ticketQuestion.findFirst.mockResolvedValue({ id: "q1", ticketId: "tk1", tenantId: "t1", askedById: "rep1" });
    const res = await STATUS(req("/api/questions/q1", "PATCH", { status: "closed" }), params("q1"));
    expect(res.status).toBe(403);
    expect(prisma.ticketQuestion.update).not.toHaveBeenCalled();
  });

  it("lets an admin tidy someone else's stale question", async () => {
    sessionUser.mockResolvedValue({ id: "boss", email: "boss@x.com", tenantId: "t1", role: "brand_admin" });
    prisma.ticketQuestion.findFirst.mockResolvedValue({ id: "q1", ticketId: "tk1", tenantId: "t1", askedById: "rep1" });
    const res = await STATUS(req("/api/questions/q1", "PATCH", { status: "closed" }), params("q1"));
    expect(res.status).toBe(200);
  });
});
