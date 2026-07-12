import { beforeEach, describe, expect, it, vi } from "vitest";

// Guided returns (Phase A) through the draft route: startReturn computes
// eligibility, feeds it to the draft engine as liveContext, marks the ticket's
// return lifecycle "requested", and audits return_started. Every external
// boundary is mocked — no model call, no ShipStation, no production DB.
const {
  prisma, sessionUser, getCurrentTenant, generateDraft, checkReturnEligibility,
  getOrderContext, getCustomerInsight, groundingNotes, extractProductMention,
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
  checkReturnEligibility: vi.fn(),
  getOrderContext: vi.fn(),
  getCustomerInsight: vi.fn(),
  groundingNotes: vi.fn(),
  extractProductMention: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/tenant", () => ({ getCurrentTenant }));
vi.mock("@/lib/roles", () => ({ sessionUser }));
vi.mock("@/lib/brain/draft", () => ({ generateDraft }));
vi.mock("@/lib/returns", () => ({ checkReturnEligibility }));
vi.mock("@/lib/shipstation", () => ({ getOrderContext, orderContextLines: (o: unknown[]) => o.map(() => "line") }));
vi.mock("@/lib/customer-insight", () => ({ getCustomerInsight }));
vi.mock("@/lib/notes", () => ({ groundingNotes }));
vi.mock("@/lib/product-extract", () => ({ extractProductMention }));
vi.mock("@/lib/stockists", () => ({ findStockists: vi.fn(), stockistLines: vi.fn(), detectPlace: vi.fn() }));
vi.mock("@/lib/arm-stock", () => ({ armStockContext: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/escalation", () => ({
  expertAnswerContext: vi.fn().mockResolvedValue([]),
  escalateCoverageGap: vi.fn().mockResolvedValue({ alreadyAsked: false, question: "", assigneeName: null }),
}));

const { POST } = await import("@/app/api/tickets/[id]/draft/route");

const req = (body: unknown) =>
  new Request("http://localhost:3014/api/tickets/tk1/draft", { method: "POST", body: JSON.stringify(body) });
const params = { params: Promise.resolve({ id: "tk1" }) };

const ELIGIBILITY = {
  verdict: "eligible" as const,
  reasons: ["most recent order #80986 placed May 18, 2026 (52 days ago), inside the 365-day Saltwater Promise window"],
  facts: { channel: "rheosgear", channelBasis: "orders on file under this email" },
  liveContext: ["Return eligibility (system-computed, rep-confirmed before anything is promised): ELIGIBLE — in window."],
};

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentTenant.mockResolvedValue({ id: "t1", slug: "rheos" });
  sessionUser.mockResolvedValue({ id: "rep1", email: "rep@x.com", tenantId: "t1", role: "agent" });
  prisma.ticket.findFirst.mockResolvedValue({
    id: "tk1",
    tenantId: "t1",
    subject: "Return request",
    category: "returns_exchange",
    customerId: "c1",
    tenant: { voiceGuide: null },
    customer: { id: "c1", email: "kris@x.com", displayName: "Kris Langlie", purchaseChannel: null },
    messages: [{ text: "I want to return my sunglasses", attachments: null }],
  });
  prisma.draft.create.mockResolvedValue({ id: "d1" });
  prisma.knowledgeItem.findMany.mockResolvedValue([]);
  prisma.ticket.update.mockResolvedValue({});
  prisma.auditEvent.create.mockResolvedValue({});
  prisma.user.findUnique.mockResolvedValue({ name: "Jasmine Doe" });
  getOrderContext.mockResolvedValue([]);
  getCustomerInsight.mockResolvedValue(null);
  groundingNotes.mockResolvedValue([]);
  extractProductMention.mockResolvedValue({ productFamily: null });
  checkReturnEligibility.mockResolvedValue(ELIGIBILITY);
  generateDraft.mockResolvedValue({
    body: "Happy to help with that return.",
    coverage: "full",
    coverageNote: null,
    citations: [],
    suggested: [],
    policyFlags: [],
  });
});

describe("POST /api/tickets/[id]/draft with startReturn", () => {
  it("rejects a non-boolean startReturn with 400 before touching the DB", async () => {
    const res = await POST(req({ startReturn: "yes" }), params);
    expect(res.status).toBe(400);
    expect(prisma.ticket.findFirst).not.toHaveBeenCalled();
  });

  it("404s on a ticket outside the session tenant", async () => {
    prisma.ticket.findFirst.mockResolvedValue(null);
    const res = await POST(req({ startReturn: true }), params);
    expect(res.status).toBe(404);
    expect(checkReturnEligibility).not.toHaveBeenCalled();
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it("computes eligibility, grounds the draft in it, marks the return requested, audits", async () => {
    const res = await POST(req({ startReturn: true }), params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.returnEligibility).toEqual({
      verdict: "eligible",
      reasons: ELIGIBILITY.reasons,
      channel: "rheosgear",
      channelBasis: "orders on file under this email",
    });

    // Eligibility computed for THIS customer in THIS tenant, with the thread
    // text so channel mentions ("bought on Amazon") are detectable.
    expect(checkReturnEligibility).toHaveBeenCalledWith(
      expect.objectContaining({ email: "kris@x.com" }),
      "t1",
      expect.stringContaining("return my sunglasses")
    );
    // Verdict lines reach the engine as trusted liveContext, plus a returns steer.
    const draftInput = generateDraft.mock.calls[0][0];
    expect(draftInput.liveContext).toEqual(expect.arrayContaining(ELIGIBILITY.liveContext));
    expect(draftInput.steerNotes).toContain("return or exchange");
    // Lifecycle + audit trail.
    expect(prisma.ticket.update).toHaveBeenCalledWith({
      where: { id: "tk1" },
      data: { status: "in_review", returnStatus: "requested" },
    });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "return_started",
        entity: "ticket:tk1",
        actorId: "rep1",
        meta: expect.objectContaining({ verdict: "eligible" }),
      }),
    });
  });

  it("a plain draft (no startReturn) computes no eligibility and leaves returnStatus alone", async () => {
    const res = await POST(req({}), params);
    expect(res.status).toBe(200);
    expect((await res.json()).returnEligibility).toBeNull();
    expect(checkReturnEligibility).not.toHaveBeenCalled();
    expect(prisma.ticket.update).toHaveBeenCalledWith({
      where: { id: "tk1" },
      data: { status: "in_review" },
    });
    const actions = prisma.auditEvent.create.mock.calls.map((c) => c[0].data.action);
    expect(actions).not.toContain("return_started");
  });
});
