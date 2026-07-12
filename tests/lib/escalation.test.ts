import { beforeEach, describe, expect, it, vi } from "vitest";

// Auto-escalation: ask the right specialist when the Brain can't answer.
// Mock every boundary before importing the lib.
const { prisma, sendEmail, getAgentUser, routeSignalAssignee } = vi.hoisted(() => ({
  prisma: {
    ticketQuestion: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    ticket: { update: vi.fn() },
    user: { findFirst: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  sendEmail: vi.fn(),
  getAgentUser: vi.fn(),
  routeSignalAssignee: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/email", () => ({ sendEmail, escapeHtml: (s: string) => s }));
vi.mock("@/lib/agent-user", () => ({
  getAgentUser,
  AGENT_USER_EMAIL: "agent@concierge.internal",
  AGENT_USER_NAME: "Concierge Agent",
}));
vi.mock("@/lib/assign", () => ({ routeSignalAssignee }));

const { escalateCoverageGap, expertAnswerContext } = await import("@/lib/escalation");

const ticket = { id: "tkt1", category: "warranty", subject: "Broken hinge" };

beforeEach(() => {
  vi.clearAllMocks();
  getAgentUser.mockResolvedValue({ id: "agent1", email: "agent@concierge.internal", name: "Concierge Agent" });
  prisma.ticketQuestion.findFirst.mockResolvedValue(null);
  prisma.ticketQuestion.create.mockResolvedValue({ id: "q1" });
  prisma.ticket.update.mockResolvedValue({});
  prisma.auditEvent.create.mockResolvedValue({});
  routeSignalAssignee.mockResolvedValue("spec1");
  prisma.user.findFirst.mockResolvedValue({ id: "spec1", name: "Dana", email: "dana@x.com" });
  sendEmail.mockResolvedValue(true);
});

describe("escalateCoverageGap", () => {
  it("asks the routed specialist, parks the ticket, audits, and emails", async () => {
    const out = await escalateCoverageGap({
      tenantId: "t1",
      ticket,
      gapQuestion: "Do we ship replacement arms to Canada, and who pays duty?",
      link: "https://x/tickets/tkt1/qa",
    });
    expect(out.alreadyAsked).toBe(false);
    expect(out.assigneeName).toBe("Dana");
    expect(routeSignalAssignee).toHaveBeenCalledWith("t1", "warranty");
    expect(prisma.ticketQuestion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ askedById: "agent1", assigneeId: "spec1", body: expect.stringContaining("Canada") }),
      })
    );
    expect(prisma.ticket.update).toHaveBeenCalledWith({ where: { id: "tkt1" }, data: { status: "awaiting_internal" } });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "coverage_escalated" }) })
    );
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: ["dana@x.com"] }));
  });

  it("dedups: does not re-ask when an open agent question already exists", async () => {
    prisma.ticketQuestion.findFirst.mockResolvedValue({ body: "already asked this", assignee: { name: "Dana", email: "dana@x.com" } });
    const out = await escalateCoverageGap({ tenantId: "t1", ticket, gapQuestion: "x", link: "l" });
    expect(out.alreadyAsked).toBe(true);
    expect(prisma.ticketQuestion.create).not.toHaveBeenCalled();
    expect(prisma.ticket.update).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("falls back to a generic question and no email when no specialist matches", async () => {
    routeSignalAssignee.mockResolvedValue(null);
    const out = await escalateCoverageGap({ tenantId: "t1", ticket: { ...ticket, category: null }, link: "l" });
    expect(out.alreadyAsked).toBe(false);
    expect(out.assigneeName).toBeNull();
    expect(prisma.ticketQuestion.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assigneeId: null }) })
    );
    expect(sendEmail).not.toHaveBeenCalled(); // no assignee to notify
  });
});

describe("expertAnswerContext", () => {
  it("turns answered agent questions into trusted context lines", async () => {
    prisma.ticketQuestion.findMany.mockResolvedValue([
      { body: "Ship arms to Canada?", replies: [{ body: "Yes, flat $12 international, customer pays duty." }] },
      { body: "Unanswered one", replies: [] },
    ]);
    const lines = await expertAnswerContext("t1", "tkt1");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Ship arms to Canada?");
    expect(lines[0]).toContain("flat $12 international");
  });
});
