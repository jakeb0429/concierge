import { beforeEach, describe, expect, it, vi } from "vitest";

// Confirm/send is the only outbound action. Guard under test: a draft sends
// exactly once — re-sending a "sent" draft must 409 (no duplicate email).
// Prisma + send are mocked before import so nothing leaves the process.
const { prisma, sessionUser, getCurrentTenant, sendReply } = vi.hoisted(() => ({
  prisma: {
    ticket: { findFirst: vi.fn(), update: vi.fn() },
    draft: { findFirst: vi.fn(), update: vi.fn() },
    message: { create: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  sessionUser: vi.fn(),
  getCurrentTenant: vi.fn(),
  sendReply: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/tenant", () => ({ getCurrentTenant }));
vi.mock("@/lib/roles", () => ({ sessionUser }));
vi.mock("@/lib/send", () => ({ sendReply }));

const { POST } = await import("@/app/api/tickets/[id]/confirm/route");

const req = (body: unknown) =>
  new Request("http://localhost:3014/api/tickets/tkt1/confirm", { method: "POST", body: JSON.stringify(body) });
const params = { params: Promise.resolve({ id: "tkt1" }) };

const ticketRow = {
  id: "tkt1",
  tenantId: "t1",
  subject: "Broken hinge",
  providerThreadId: "thread-1",
  channel: "gmail",
  customer: { email: "dealer@example.com" },
  channelRef: { provider: "gmail", supportAddress: "help@rheosgear.com" },
  tenant: { channels: [] },
  messages: [{ providerMessageId: "in-1" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentTenant.mockResolvedValue({ id: "t1", slug: "rheos" });
  sessionUser.mockResolvedValue({ id: "u1", email: "rep@x.com", tenantId: "t1", role: "agent" });
  prisma.ticket.findFirst.mockResolvedValue(ticketRow);
  prisma.draft.update.mockResolvedValue({});
  prisma.message.create.mockResolvedValue({});
  prisma.ticket.update.mockResolvedValue({});
  prisma.auditEvent.create.mockResolvedValue({});
  sendReply.mockResolvedValue({ providerMessageId: "out-1", live: true });
});

describe("POST /api/tickets/[id]/confirm", () => {
  it("sends a prepared draft and marks the ticket replied", async () => {
    prisma.draft.findFirst.mockResolvedValue({ id: "d1", ticketId: "tkt1", status: "prepared", body: "Hi there" });
    const res = await POST(req({ draftId: "d1", finalBody: "Hi there" }), params);
    expect(res.status).toBe(200);
    expect(sendReply).toHaveBeenCalledTimes(1);
    expect(prisma.draft.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "d1" }, data: expect.objectContaining({ status: "sent" }) }),
    );
    expect(prisma.ticket.update).toHaveBeenCalledWith({ where: { id: "tkt1" }, data: { status: "replied" } });
  });

  it("refuses to re-send an already-sent draft (409) — no duplicate email", async () => {
    prisma.draft.findFirst.mockResolvedValue({ id: "d1", ticketId: "tkt1", status: "sent", body: "Hi there" });
    const res = await POST(req({ draftId: "d1", finalBody: "Hi there" }), params);
    expect(res.status).toBe(409);
    expect(sendReply).not.toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it("sends a fresh follow-up draft on a ticket that was already replied once", async () => {
    // The prior reply is "sent"; the follow-up is a new prepared draft.
    prisma.draft.findFirst.mockResolvedValue({ id: "d2", ticketId: "tkt1", status: "prepared", body: "Following up" });
    const res = await POST(req({ draftId: "d2", finalBody: "Following up" }), params);
    expect(res.status).toBe(200);
    expect(sendReply).toHaveBeenCalledTimes(1);
  });
});
