import { beforeEach, describe, expect, it, vi } from "vitest";

// User provisioning gates: admin-only, create-vs-edit split (409 on existing),
// and the PATCH guards — no self role change, no super_admin edits from the UI.
const { prisma, requireAdmin, getCurrentTenant } = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  requireAdmin: vi.fn(),
  getCurrentTenant: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/tenant", () => ({ getCurrentTenant }));
vi.mock("@/lib/roles", () => ({ requireAdmin }));

const { POST } = await import("@/app/api/users/route");
const { PATCH } = await import("@/app/api/users/[id]/route");

const admin = { id: "adm1", email: "adm@x.com", tenantId: "t1", role: "brand_admin" };
const postReq = (body: unknown) =>
  new Request("http://localhost:3014/api/users", { method: "POST", body: JSON.stringify(body) });
const patchReq = (id: string, body: unknown) =>
  new Request(`http://localhost:3014/api/users/${id}`, { method: "PATCH", body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentTenant.mockResolvedValue({ id: "t1", slug: "rheos" });
  prisma.auditEvent.create.mockResolvedValue({});
});

describe("POST /api/users", () => {
  it("rejects a non-admin with 403", async () => {
    requireAdmin.mockRejectedValue(Object.assign(new Error("Admin access required."), { status: 403 }));
    const res = await POST(postReq({ email: "new@x.com" }));
    expect(res.status).toBe(403);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("returns 409 when the (normalized) email already exists in the tenant", async () => {
    requireAdmin.mockResolvedValue(admin);
    prisma.user.findUnique.mockResolvedValue({ id: "u1", email: "dup@x.com" });
    const res = await POST(postReq({ email: "  Dup@X.com " }));
    expect(res.status).toBe(409);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { tenantId_email: { tenantId: "t1", email: "dup@x.com" } },
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("creates a new teammate with an audit row", async () => {
    requireAdmin.mockResolvedValue(admin);
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: "u2" });
    const res = await POST(postReq({ email: "New@Rheos.com", name: "New Person", role: "team_lead", specialties: ["warranty"] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: "u2" });
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: { tenantId: "t1", email: "new@rheos.com", name: "New Person", role: "team_lead", specialties: ["warranty"] },
    });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "user_provisioned", entity: "user:u2" }),
    });
  });
});

describe("PATCH /api/users/[id]", () => {
  it("rejects a non-admin with 403", async () => {
    requireAdmin.mockRejectedValue(Object.assign(new Error("Admin access required."), { status: 403 }));
    const res = await PATCH(patchReq("u1", { role: "agent" }), params("u1"));
    expect(res.status).toBe(403);
  });

  it("blocks an admin changing their own role (400)", async () => {
    requireAdmin.mockResolvedValue(admin);
    prisma.user.findFirst.mockResolvedValue({ id: "adm1", tenantId: "t1", role: "brand_admin" });
    const res = await PATCH(patchReq("adm1", { role: "agent" }), params("adm1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/own role/);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("blocks role edits on a super_admin (script-managed) with 400", async () => {
    requireAdmin.mockResolvedValue(admin);
    prisma.user.findFirst.mockResolvedValue({ id: "u9", tenantId: "t1", role: "super_admin" });
    const res = await PATCH(patchReq("u9", { role: "agent" }), params("u9"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/super_admin/);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("lets an admin update another teammate's role and specialties", async () => {
    requireAdmin.mockResolvedValue(admin);
    prisma.user.findFirst.mockResolvedValue({ id: "u1", tenantId: "t1", role: "agent" });
    prisma.user.update.mockResolvedValue({ id: "u1" });
    const res = await PATCH(patchReq("u1", { role: "team_lead", specialties: ["sizing_fit"] }), params("u1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { role: "team_lead", specialties: ["sizing_fit"] },
    });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "user_updated", entity: "user:u1", actorId: "adm1" }),
    });
  });
});
