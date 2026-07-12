import { beforeEach, describe, expect, it, vi } from "vitest";

// Auto-escalation close-out through the reply route: when a teammate ANSWERS a
// question the agent asked (the open->answered transition), the ticket flips
// back into the reply queue and exactly ONE coverage_gap LearningSignal trains
// the Brain. A specialist's second reply must NOT mint a duplicate signal, and
// human-asked questions never trigger the close-out. Boundaries are mocked.
const {
  prisma, getCurrentTenant, sessionUser, sendEmail, routeSignalAssignee,
} = vi.hoisted(() => ({
  prisma: {
    ticketQuestion: { findFirst: vi.fn(), update: vi.fn() },
    ticketQuestionReply: { create: vi.fn() },
    ticket: { update: vi.fn() },
    learningSignal: { create: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  getCurrentTenant: vi.fn(),
  sessionUser: vi.fn(),
  sendEmail: vi.fn(),
  routeSignalAssignee: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/tenant", () => ({ getCurrentTenant }));
vi.mock("@/lib/roles", () => ({ sessionUser }));
vi.mock("@/lib/email", () => ({ sendEmail, escapeHtml: (s: string) => s }));
vi.mock("@/lib/base-url", () => ({ baseUrl: () => "http://localhost:3014" }));
vi.mock("@/lib/log", () => ({ logger: { error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/agent-user", () => ({ AGENT_USER_EMAIL: "agent@concierge.internal" }));
vi.mock("@/lib/assign", () => ({ routeSignalAssignee }));

const { POST } = await import("@/app/api/questions/[id]/replies/route");

const req = (body: unknown) =>
  new Request("http://localhost:3014/api/questions/q1/replies", { method: "POST", body: JSON.stringify(body) });
const params = { params: Promise.resolve({ id: "q1" }) };

// A question the AGENT asked, currently open, parked on an awaiting_internal ticket.
const agentQuestionOpen = {
  id: "q1",
  ticketId: "tk1",
  askedById: "agent1",
  status: "open",
  body: "Do we sponsor pickleball tournaments, and who approves it?",
  askedBy: { id: "agent1", email: "agent@concierge.internal" },
  assignee: { id: "spec1", email: "dana@x.com" },
  ticket: { id: "tk1", subject: "Sponsorship?", status: "awaiting_internal", category: "other" },
};

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentTenant.mockResolvedValue({ id: "t1" });
  // The teammate answering is NOT the asker (the agent bot).
  sessionUser.mockResolvedValue({ id: "spec1", email: "dana@x.com" });
  prisma.ticketQuestion.findFirst.mockResolvedValue(agentQuestionOpen);
  prisma.ticketQuestionReply.create.mockResolvedValue({ id: "r1" });
  prisma.ticketQuestion.update.mockResolvedValue({});
  prisma.ticket.update.mockResolvedValue({});
  prisma.learningSignal.create.mockResolvedValue({ id: "sig1" });
  prisma.auditEvent.create.mockResolvedValue({});
  routeSignalAssignee.mockResolvedValue("spec1");
  sendEmail.mockResolvedValue(true);
});

describe("POST /api/questions/[id]/replies — escalation close-out", () => {
  it("answering an agent-asked OPEN question flips the ticket to new and mints exactly one coverage_gap signal", async () => {
    const res = await POST(req({ body: "Yes — up to $500, ops approves." }), params);
    expect(res.status).toBe(200);
    // Ticket returns to the reply queue.
    expect(prisma.ticket.update).toHaveBeenCalledWith({ where: { id: "tk1" }, data: { status: "new" } });
    // Exactly one signal, carrying the teammate's answer as the proposed text.
    expect(prisma.learningSignal.create).toHaveBeenCalledTimes(1);
    expect(prisma.learningSignal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "coverage_gap",
          proposedText: "Yes — up to $500, ops approves.",
        }),
      })
    );
    const actions = prisma.auditEvent.create.mock.calls.map((c) => c[0].data.action);
    expect(actions).toContain("coverage_gap_learned");
  });

  it("a SECOND reply on the now-answered question mints no further signal (the once-guard)", async () => {
    prisma.ticketQuestion.findFirst.mockResolvedValue({ ...agentQuestionOpen, status: "answered" });
    const res = await POST(req({ body: "One more note for you." }), params);
    expect(res.status).toBe(200);
    // No open->answered transition this time — no duplicate signal, no re-flip.
    expect(prisma.learningSignal.create).not.toHaveBeenCalled();
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it("answering a HUMAN-asked question never triggers the close-out", async () => {
    prisma.ticketQuestion.findFirst.mockResolvedValue({
      ...agentQuestionOpen,
      askedById: "repA",
      askedBy: { id: "repA", email: "rep@x.com" },
    });
    const res = await POST(req({ body: "Here's the answer." }), params);
    expect(res.status).toBe(200);
    expect(prisma.learningSignal.create).not.toHaveBeenCalled();
  });
});
