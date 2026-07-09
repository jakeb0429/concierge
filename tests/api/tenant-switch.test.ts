import { beforeEach, describe, expect, it, vi } from "vitest";

// Brand-switch gate: the target tenant must hold a User row for this email —
// otherwise the session token is never rewritten.
const { prisma, sessionUser, unstable_update } = vi.hoisted(() => ({
  prisma: { tenant: { findUnique: vi.fn() }, user: { findUnique: vi.fn() } },
  sessionUser: vi.fn(),
  unstable_update: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/roles", () => ({ sessionUser }));
// @/lib/auth boots NextAuth at import time — stub the one function used here.
vi.mock("@/lib/auth", () => ({ unstable_update }));

const { POST } = await import("@/app/api/tenant/switch/route");

const req = (tenantSlug: string) =>
  new Request("http://localhost:3014/api/tenant/switch", { method: "POST", body: JSON.stringify({ tenantSlug }) });
const jake = { id: "u1", email: "jake@scribechs.com", tenantId: "t1", role: "brand_admin" };

beforeEach(() => {
  vi.clearAllMocks();
  unstable_update.mockResolvedValue(null);
});

describe("POST /api/tenant/switch", () => {
  it("401s when not signed in", async () => {
    sessionUser.mockResolvedValue(null);
    const res = await POST(req("stingray"));
    expect(res.status).toBe(401);
    expect(unstable_update).not.toHaveBeenCalled();
  });

  it("403s when the user has no row in the target tenant", async () => {
    sessionUser.mockResolvedValue(jake);
    prisma.tenant.findUnique.mockResolvedValue({ id: "t2", slug: "stingray" });
    prisma.user.findUnique.mockResolvedValue(null);
    const res = await POST(req("stingray"));
    expect(res.status).toBe(403);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { tenantId_email: { tenantId: "t2", email: "jake@scribechs.com" } },
    });
    expect(unstable_update).not.toHaveBeenCalled();
  });

  it("switches the session when the email is provisioned on the target brand", async () => {
    sessionUser.mockResolvedValue(jake);
    prisma.tenant.findUnique.mockResolvedValue({ id: "t2", slug: "stingray" });
    prisma.user.findUnique.mockResolvedValue({ id: "u2", tenantId: "t2", email: "jake@scribechs.com" });
    const res = await POST(req("stingray"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, tenant: "stingray" });
    expect(unstable_update).toHaveBeenCalledWith({ tenantId: "t2" });
  });
});
