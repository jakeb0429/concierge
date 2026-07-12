import { beforeEach, describe, expect, it, vi } from "vitest";

// Auto-escalation through the draft route: when the Brain can't answer
// (coverage "none") the agent escalates to a specialist INSTEAD of persisting a
// hollow draft — UNLESS a teammate has already answered an earlier escalation
// on this ticket, in which case the expert answer is in liveContext and we
// persist the grounded draft (breaking the re-escalation dead loop). Every
// external boundary is mocked — no model call, no production DB.
const {
  prisma, sessionUser, getCurrentTenant, generateDraft,
  getOrderContext, getCustomerInsight, groundingNotes, extractProductMention,
  escalateCoverageGap, expertAnswerContext,
} = vi.hoisted(() => ({
  prisma: {
    ticket: { findFirst: vi.fn(), update: vi.fn() },
    draft: { create: vi.fn(), findFirst: vi.fn() },
    knowledgeItem: { findMany: vi.fn(), updateMany: vi.fn() },
    user: { findUnique: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  sessionUser: vi.fn(),
  getCurrentTenant: vi.fn(),
  generateDraft: vi.fn(),
  getOrderContext: vi.fn(),
  getCustomerInsight: vi.fn(),
  groundingNotes: vi.fn(),
  extractProductMention: vi.fn(),
  escalateCoverageGap: vi.fn(),
  expertAnswerContext: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/tenant", () => ({ getCurrentTenant }));
vi.mock("@/lib/roles", () => ({ sessionUser }));
vi.mock("@/lib/brain/draft", () => ({ generateDraft }));
vi.mock("@/lib/returns", () => ({ checkReturnEligibility: vi.fn() }));
vi.mock("@/lib/shipstation", () => ({ getOrderContext, orderContextLines: (o: unknown[]) => o.map(() => "line") }));
vi.mock("@/lib/customer-insight", () => ({ getCustomerInsight }));
vi.mock("@/lib/notes", () => ({ groundingNotes }));
vi.mock("@/lib/product-extract", () => ({ extractProductMention }));
vi.mock("@/lib/stockists", () => ({ findStockists: vi.fn(), stockistLines: vi.fn(), detectPlace: vi.fn() }));
vi.mock("@/lib/arm-stock", () => ({ armStockContext: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/base-url", () => ({ baseUrl: () => "http://localhost:3014" }));
vi.mock("@/lib/escalation", () => ({ escalateCoverageGap, expertAnswerContext }));

const { POST } = await import("@/app/api/tickets/[id]/draft/route");

const req = (body: unknown) =>
  new Request("http://localhost:3014/api/tickets/tk1/draft", { method: "POST", body: JSON.stringify(body) });
const params = { params: Promise.resolve({ id: "tk1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentTenant.mockResolvedValue({ id: "t1", slug: "rheos" });
  sessionUser.mockResolvedValue({ id: "rep1", email: "rep@x.com", tenantId: "t1", role: "agent" });
  prisma.ticket.findFirst.mockResolvedValue({
    id: "tk1",
    tenantId: "t1",
    subject: "Weird question we've never seen",
    category: "other",
    customerId: "c1",
    tenant: { voiceGuide: null },
    customer: { id: "c1", email: "kris@x.com", displayName: "Kris", purchaseChannel: null },
    messages: [{ text: "Do you sponsor pickleball tournaments?", attachments: null }],
  });
  prisma.draft.create.mockResolvedValue({ id: "d1" });
  prisma.knowledgeItem.findMany.mockResolvedValue([]);
  prisma.ticket.update.mockResolvedValue({});
  prisma.auditEvent.create.mockResolvedValue({});
  prisma.user.findUnique.mockResolvedValue({ name: "Jasmine" });
  getOrderContext.mockResolvedValue([]);
  getCustomerInsight.mockResolvedValue(null);
  groundingNotes.mockResolvedValue([]);
  extractProductMention.mockResolvedValue({ productFamily: null });
  expertAnswerContext.mockResolvedValue([]);
  escalateCoverageGap.mockResolvedValue({ alreadyAsked: false, question: "Do we sponsor tournaments?", assigneeName: "Dana" });
  generateDraft.mockResolvedValue({
    body: "",
    coverage: "none",
    coverageNote: "No knowledge covers sponsorships.",
    gapQuestion: "Do we sponsor pickleball tournaments, and who approves it?",
    citations: [],
    suggested: [],
    policyFlags: [],
  });
});

describe("POST /api/tickets/[id]/draft — auto-escalation", () => {
  it("coverage=none with no prior expert answer: escalates and persists NO draft", async () => {
    const res = await POST(req({}), params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.escalated).toBe(true);
    expect(json.assigneeName).toBe("Dana");
    // The gap question the model produced is what gets routed to the specialist.
    expect(escalateCoverageGap).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "t1",
        gapQuestion: "Do we sponsor pickleball tournaments, and who approves it?",
      })
    );
    // No hollow draft is written while we wait on the teammate.
    expect(prisma.draft.create).not.toHaveBeenCalled();
  });

  it("coverage=none but an expert already answered: does NOT re-escalate — persists the grounded draft", async () => {
    // A teammate answered an earlier escalation; the answer is now trusted context.
    expertAnswerContext.mockResolvedValue([
      'Internal expert answer (verified) to "Do we sponsor tournaments?": Yes, up to $500, ops approves.',
    ]);
    const res = await POST(req({}), params);
    expect(res.status).toBe(200);
    const json = await res.json();
    // Breaks the dead loop: persist instead of re-asking (which would strand the ticket).
    expect(escalateCoverageGap).not.toHaveBeenCalled();
    expect(prisma.draft.create).toHaveBeenCalled();
    expect(json.draftId).toBe("d1");
    // The expert answer was handed to the engine as trusted liveContext.
    const draftInput = generateDraft.mock.calls[0][0];
    expect(draftInput.liveContext).toEqual(
      expect.arrayContaining([expect.stringContaining("Internal expert answer")])
    );
  });

  it("coverage=full: never escalates, persists the draft normally", async () => {
    generateDraft.mockResolvedValue({
      body: "Yes! Here are the details.",
      coverage: "full",
      coverageNote: null,
      citations: [],
      suggested: [],
      policyFlags: [],
    });
    const res = await POST(req({}), params);
    expect(res.status).toBe(200);
    expect(escalateCoverageGap).not.toHaveBeenCalled();
    expect(prisma.draft.create).toHaveBeenCalled();
  });
});
