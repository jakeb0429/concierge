import { beforeEach, describe, expect, it, vi } from "vitest";

// Parts (arm inventory) CRUD: any signed-in staff may manage stock; edits are
// tenant-scoped and audited. Prisma + auth mocked before import.
const { prisma, sessionUser, getCurrentTenant } = vi.hoisted(() => ({
  prisma: {
    armInventory: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  sessionUser: vi.fn(),
  getCurrentTenant: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/tenant", () => ({ getCurrentTenant }));
vi.mock("@/lib/roles", () => ({ sessionUser }));

const { POST } = await import("@/app/api/parts/route");
const { PATCH } = await import("@/app/api/parts/[id]/route");

const post = (body: unknown) =>
  new Request("http://localhost:3014/api/parts", { method: "POST", body: JSON.stringify(body) });
const patch = (body: unknown) =>
  new Request("http://localhost:3014/api/parts/arm1", { method: "PATCH", body: JSON.stringify(body) });
const patchParams = { params: Promise.resolve({ id: "arm1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentTenant.mockResolvedValue({ id: "t1", slug: "rheos" });
  sessionUser.mockResolvedValue({ id: "u1", email: "rep@x.com", tenantId: "t1", role: "agent" });
  prisma.armInventory.create.mockResolvedValue({ id: "arm9", sku: "13003-00100", brand: "Bahias", leftCount: 5, rightCount: 5 });
  prisma.armInventory.update.mockResolvedValue({});
  prisma.auditEvent.create.mockResolvedValue({});
});

describe("POST /api/parts", () => {
  it("rejects an unauthenticated caller (401) before any DB write", async () => {
    sessionUser.mockResolvedValue(null);
    const res = await POST(post({ sku: "x", brand: "Bahias" }));
    expect(res.status).toBe(401);
    expect(prisma.armInventory.create).not.toHaveBeenCalled();
  });

  it("400s an invalid body before touching the DB", async () => {
    const res = await POST(post({ brand: "Bahias" })); // missing sku
    expect(res.status).toBe(400);
    expect(prisma.armInventory.findFirst).not.toHaveBeenCalled();
  });

  it("409s a duplicate SKU", async () => {
    prisma.armInventory.findFirst.mockResolvedValue({ id: "arm1" });
    const res = await POST(post({ sku: "13003-00100", brand: "Bahias" }));
    expect(res.status).toBe(409);
    expect(prisma.armInventory.create).not.toHaveBeenCalled();
  });

  it("creates a new arm SKU and writes an audit row", async () => {
    prisma.armInventory.findFirst.mockResolvedValue(null);
    const res = await POST(post({ sku: "13003-00100", brand: "Bahias", leftCount: 5, rightCount: 5 }));
    expect(res.status).toBe(200);
    expect(prisma.armInventory.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tenantId: "t1", sku: "13003-00100", brand: "Bahias" }) })
    );
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "arm_sku_added", entity: "arm:arm9" }) })
    );
  });
});

describe("PATCH /api/parts/[id]", () => {
  it("rejects an unauthenticated caller (401)", async () => {
    sessionUser.mockResolvedValue(null);
    const res = await PATCH(patch({ leftCount: 4 }), patchParams);
    expect(res.status).toBe(401);
  });

  it("404s an arm from another tenant", async () => {
    prisma.armInventory.findFirst.mockResolvedValue(null);
    const res = await PATCH(patch({ leftCount: 4 }), patchParams);
    expect(res.status).toBe(404);
    expect(prisma.armInventory.update).not.toHaveBeenCalled();
  });

  it("updates counts and audits the change", async () => {
    prisma.armInventory.findFirst.mockResolvedValue({ id: "arm1", tenantId: "t1", sku: "13003-00100", leftCount: 10, rightCount: 10 });
    const res = await PATCH(patch({ leftCount: 9 }), patchParams);
    expect(res.status).toBe(200);
    expect(prisma.armInventory.update).toHaveBeenCalledWith({ where: { id: "arm1" }, data: { leftCount: 9 } });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "arm_count_updated", meta: expect.objectContaining({ leftFrom: 10, leftTo: 9 }) }) })
    );
  });

  it("400s an empty update", async () => {
    prisma.armInventory.findFirst.mockResolvedValue({ id: "arm1", tenantId: "t1", sku: "x", leftCount: 1, rightCount: 1 });
    const res = await PATCH(patch({}), patchParams);
    expect(res.status).toBe(400);
    expect(prisma.armInventory.update).not.toHaveBeenCalled();
  });
});
