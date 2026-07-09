import { beforeEach, describe, expect, it, vi } from "vitest";

// Signal resolution gate: lead/admin OR the assigned specialist — nobody else.
// Approval is the only path from Ledger to Brain, so the write targets matter.
const { prisma, sessionUser, getCurrentTenant, reindexKnowledgeItem } = vi.hoisted(() => ({
  prisma: {
    learningSignal: { findFirst: vi.fn(), update: vi.fn() },
    knowledgeItem: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    tenant: { update: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  sessionUser: vi.fn(),
  getCurrentTenant: vi.fn(),
  reindexKnowledgeItem: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/tenant", () => ({ getCurrentTenant }));
vi.mock("@/lib/roles", () => ({
  sessionUser,
  isAdminRole: (role: string | null | undefined) => role === "brand_admin" || role === "super_admin",
}));
vi.mock("@/lib/brain/index-write", () => ({ reindexKnowledgeItem }));

const { PATCH } = await import("@/app/api/signals/[id]/route");

const req = (body: unknown) =>
  new Request("http://localhost:3014/api/signals/s1", { method: "PATCH", body: JSON.stringify(body) });
const params = { params: Promise.resolve({ id: "s1" }) };

// An "answer" revision signal routed to specialist u-spec.
const openSignal = {
  id: "s1",
  tenantId: "t1",
  status: "open",
  kind: "question",
  category: "warranty",
  assigneeId: "u-spec",
  knowledgeItemId: "k1",
  proposedTarget: "answer",
  proposedText: "Lifetime warranty covers lens replacement.",
  evidence: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentTenant.mockResolvedValue({ id: "t1", slug: "rheos", voiceGuide: null });
  prisma.auditEvent.create.mockResolvedValue({});
  reindexKnowledgeItem.mockResolvedValue(undefined);
});

describe("PATCH /api/signals/[id]", () => {
  it("rejects an unrelated agent with 403 — the question is assigned to someone else", async () => {
    prisma.learningSignal.findFirst.mockResolvedValue(openSignal);
    sessionUser.mockResolvedValue({ id: "u-other", email: "o@x.com", tenantId: "t1", role: "agent" });
    const res = await PATCH(req({ action: "approve" }), params);
    expect(res.status).toBe(403);
    expect(prisma.learningSignal.update).not.toHaveBeenCalled();
    expect(prisma.knowledgeItem.update).not.toHaveBeenCalled();
  });

  it("lets the assigned specialist approve — answer revised, version bumped, reindexed", async () => {
    prisma.learningSignal.findFirst.mockResolvedValue(openSignal);
    sessionUser.mockResolvedValue({ id: "u-spec", email: "s@x.com", tenantId: "t1", role: "agent" });
    prisma.knowledgeItem.findUnique.mockResolvedValue({ id: "k1", title: "Warranty", version: 3 });
    prisma.knowledgeItem.update.mockResolvedValue({ id: "k1", version: 4 });
    prisma.learningSignal.update.mockResolvedValue({ id: "s1", status: "approved" });

    const res = await PATCH(req({ action: "approve" }), params);
    expect(res.status).toBe(200);
    expect((await res.json()).signal.status).toBe("approved");
    // Only open signals in the session tenant are resolvable.
    expect(prisma.learningSignal.findFirst).toHaveBeenCalledWith({
      where: { id: "s1", tenantId: "t1", status: "open" },
    });
    expect(prisma.knowledgeItem.update).toHaveBeenCalledWith({
      where: { id: "k1" },
      data: { answer: openSignal.proposedText, version: 4 },
    });
    expect(reindexKnowledgeItem).toHaveBeenCalledWith("k1", "Warranty", openSignal.proposedText);
    expect(prisma.learningSignal.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: expect.objectContaining({ status: "approved", resolvedAt: expect.any(Date) }),
    });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "signal_approved", entity: "signal:s1" }),
    });
  });

  it("dismiss marks the signal dismissed without touching the Brain", async () => {
    prisma.learningSignal.findFirst.mockResolvedValue(openSignal);
    sessionUser.mockResolvedValue({ id: "u-spec", email: "s@x.com", tenantId: "t1", role: "agent" });
    prisma.learningSignal.update.mockResolvedValue({ id: "s1", status: "dismissed" });

    const res = await PATCH(req({ action: "dismiss" }), params);
    expect(res.status).toBe(200);
    expect((await res.json()).signal.status).toBe("dismissed");
    expect(prisma.learningSignal.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: expect.objectContaining({ status: "dismissed", resolvedAt: expect.any(Date) }),
    });
    expect(prisma.knowledgeItem.update).not.toHaveBeenCalled();
    expect(prisma.knowledgeItem.create).not.toHaveBeenCalled();
    expect(reindexKnowledgeItem).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "signal_dismissed" }),
    });
  });
});
