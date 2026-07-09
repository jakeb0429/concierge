import { beforeEach, describe, expect, it, vi } from "vitest";

// Review workflow gate: anyone may SUBMIT, only lead/admin may approve/return.
// Prisma is mocked before import so the production DB is unreachable.
const { prisma, sessionUser, getCurrentTenant } = vi.hoisted(() => ({
  prisma: {
    draft: { findFirst: vi.fn(), update: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  sessionUser: vi.fn(),
  getCurrentTenant: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/tenant", () => ({ getCurrentTenant }));
vi.mock("@/lib/roles", () => ({
  sessionUser,
  isAdminRole: (role: string | null | undefined) => role === "brand_admin" || role === "super_admin",
}));

const { POST } = await import("@/app/api/drafts/[id]/review/route");

const req = (body: unknown) =>
  new Request("http://localhost:3014/api/drafts/d1/review", { method: "POST", body: JSON.stringify(body) });
const params = { params: Promise.resolve({ id: "d1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentTenant.mockResolvedValue({ id: "t1", slug: "rheos" });
  prisma.draft.update.mockResolvedValue({});
  prisma.auditEvent.create.mockResolvedValue({});
});

describe("POST /api/drafts/[id]/review", () => {
  it("rejects approve by an agent with 403 — before any draft lookup", async () => {
    sessionUser.mockResolvedValue({ id: "u1", email: "a@x.com", tenantId: "t1", role: "agent" });
    const res = await POST(req({ action: "approve" }), params);
    expect(res.status).toBe(403);
    expect(prisma.draft.findFirst).not.toHaveBeenCalled();
    expect(prisma.draft.update).not.toHaveBeenCalled();
  });

  it("lets an agent submit their draft for review", async () => {
    sessionUser.mockResolvedValue({ id: "u1", email: "a@x.com", tenantId: "t1", role: "agent" });
    prisma.draft.findFirst.mockResolvedValue({ id: "d1", tenantId: "t1", status: "prepared" });
    const res = await POST(req({ action: "submit" }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "pending_review" });
    expect(prisma.draft.findFirst).toHaveBeenCalledWith({ where: { id: "d1", tenantId: "t1" } });
    expect(prisma.draft.update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: { status: "pending_review", reviewNote: null },
    });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "review_submit", entity: "draft:d1", actorId: "u1" }),
    });
  });

  it("lets a brand_admin approve — rep gets the green light to send", async () => {
    sessionUser.mockResolvedValue({ id: "adm", email: "adm@x.com", tenantId: "t1", role: "brand_admin" });
    prisma.draft.findFirst.mockResolvedValue({ id: "d1", tenantId: "t1", status: "pending_review" });
    const res = await POST(req({ action: "approve" }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "approved" });
    expect(prisma.draft.update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: { status: "approved", reviewNote: null },
    });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "review_approve", entity: "draft:d1" }),
    });
  });
});
