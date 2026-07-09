import { beforeEach, describe, expect, it, vi } from "vitest";

// Route-gate tests (DEVELOPMENT-STANDARDS §1): session + tenant + prisma are
// mocked before the route is imported, so no test here can reach the .env
// (production) database or the vector index.
const { prisma, sessionUser, getCurrentTenant, reindexKnowledgeItem } = vi.hoisted(() => ({
  prisma: {
    knowledgeItem: { create: vi.fn(), update: vi.fn(), findFirstOrThrow: vi.fn() },
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

const { POST } = await import("@/app/api/knowledge/route");
const { PATCH } = await import("@/app/api/knowledge/[id]/route");

const tenant = { id: "t1", slug: "rheos" };
const postReq = (body: unknown) =>
  new Request("http://localhost:3014/api/knowledge", { method: "POST", body: JSON.stringify(body) });
const patchReq = (body: unknown) =>
  new Request("http://localhost:3014/api/knowledge/k1", { method: "PATCH", body: JSON.stringify(body) });
const params = { params: Promise.resolve({ id: "k1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentTenant.mockResolvedValue(tenant);
  prisma.auditEvent.create.mockResolvedValue({});
  reindexKnowledgeItem.mockResolvedValue(undefined);
});

describe("POST /api/knowledge", () => {
  it("rejects an agent with 403 — direct Brain writes are lead/admin territory", async () => {
    sessionUser.mockResolvedValue({ id: "u1", email: "a@x.com", tenantId: "t1", role: "agent" });
    const res = await POST(postReq({ title: "Care", answer: "Rinse with fresh water." }));
    expect(res.status).toBe(403);
    expect(prisma.knowledgeItem.create).not.toHaveBeenCalled();
  });

  it("lets a team_lead create an item, scoped to the session tenant, with an audit row", async () => {
    sessionUser.mockResolvedValue({ id: "u2", email: "lead@x.com", tenantId: "t1", role: "team_lead" });
    prisma.knowledgeItem.create.mockResolvedValue({
      id: "k1",
      title: "Care",
      answer: "Rinse with fresh water.",
    });
    const res = await POST(postReq({ title: "Care", answer: "Rinse with fresh water.", triggerPhrases: "care, cleaning" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.item.id).toBe("k1");
    expect(prisma.knowledgeItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "t1",
        title: "Care",
        triggerPhrases: ["care", "cleaning"],
        status: "approved",
      }),
    });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: "t1", action: "answer_promoted", entity: "knowledge:k1" }),
    });
    expect(reindexKnowledgeItem).toHaveBeenCalledWith("k1", "Care", "Rinse with fresh water.");
  });
});

describe("PATCH /api/knowledge/[id]", () => {
  it("rejects an agent with 403", async () => {
    sessionUser.mockResolvedValue({ id: "u1", email: "a@x.com", tenantId: "t1", role: "agent" });
    const res = await PATCH(patchReq({ answer: "New answer" }), params);
    expect(res.status).toBe(403);
    expect(prisma.knowledgeItem.update).not.toHaveBeenCalled();
  });

  it("lets a team_lead edit the answer — version bumps and the item reindexes", async () => {
    sessionUser.mockResolvedValue({ id: "u2", email: "lead@x.com", tenantId: "t1", role: "team_lead" });
    prisma.knowledgeItem.findFirstOrThrow.mockResolvedValue({
      id: "k1",
      tenantId: "t1",
      title: "Care",
      answer: "Old answer",
      status: "approved",
      version: 1,
    });
    prisma.knowledgeItem.update.mockResolvedValue({
      id: "k1",
      title: "Care",
      answer: "New answer",
      status: "approved",
      version: 2,
    });
    const res = await PATCH(patchReq({ answer: "New answer" }), params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.item.version).toBe(2);
    // Tenant scope on the read (the write is keyed by the scoped read's id).
    expect(prisma.knowledgeItem.findFirstOrThrow).toHaveBeenCalledWith({
      where: { id: "k1", tenantId: "t1" },
    });
    expect(prisma.knowledgeItem.update).toHaveBeenCalledWith({
      where: { id: "k1" },
      data: expect.objectContaining({ answer: "New answer", version: 2 }),
    });
    expect(reindexKnowledgeItem).toHaveBeenCalledWith("k1", "Care", "New answer");
  });
});
