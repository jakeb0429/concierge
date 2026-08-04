import { describe, expect, it, vi, beforeEach } from "vitest";

// In-memory Customer table backing a minimal prisma mock — enough to exercise
// the cluster/link/unlink logic without a DB.
type Row = { id: string; tenantId: string; email: string | null; displayName: string | null; primaryId: string | null; createdAt: Date };
let rows: Row[] = [];

vi.mock("@/lib/db", () => ({
  prisma: {
    customer: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const r = rows.find((x) => x.id === where.id);
        if (!r) throw new Error("not found");
        return r;
      },
      findFirstOrThrow: async ({ where }: { where: { id: string; tenantId: string } }) => {
        const r = rows.find((x) => x.id === where.id && x.tenantId === where.tenantId);
        if (!r) throw new Error("not found");
        return r;
      },
      findMany: async ({ where }: { where: { OR?: { id?: string; primaryId?: string }[]; tenantId?: string; primaryId?: string } }) => {
        let out = rows;
        if (where.tenantId) out = out.filter((x) => x.tenantId === where.tenantId);
        if (where.OR) out = out.filter((x) => where.OR!.some((c) => (c.id ? x.id === c.id : x.primaryId === c.primaryId)));
        if (where.primaryId) out = out.filter((x) => x.primaryId === where.primaryId);
        return [...out].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const r = rows.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return r;
      },
      updateMany: async ({ where, data }: { where: { tenantId?: string; OR?: { id?: string; primaryId?: string }[]; NOT?: { id: string }; id?: { in: string[] } }; data: Partial<Row> }) => {
        for (const r of rows) {
          if (where.tenantId && r.tenantId !== where.tenantId) continue;
          if (where.id && !where.id.in.includes(r.id)) continue;
          if (where.OR && !where.OR.some((c) => (c.id ? r.id === c.id : r.primaryId === c.primaryId))) continue;
          if (where.NOT && r.id === where.NOT.id) continue;
          Object.assign(r, data);
        }
      },
    },
  },
}));

import { identityCluster, linkCustomers, unlinkCustomer } from "@/lib/customer-links";

const row = (id: string, email: string, primaryId: string | null = null, mins = 0): Row => ({
  id,
  tenantId: "t1",
  email,
  displayName: null,
  primaryId,
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, mins)),
});

beforeEach(() => {
  rows = [row("a", "a@x.com", null, 0), row("b", "b@x.com", null, 1), row("c", "c@x.com", null, 2)];
});

describe("customer identity clusters", () => {
  it("a standalone profile is its own cluster", async () => {
    const c = await identityCluster("a");
    expect(c.primaryId).toBe("a");
    expect(c.emails).toEqual(["a@x.com"]);
  });

  it("linking merges the other profile into this cluster (and resolves from any member)", async () => {
    await linkCustomers("t1", "a", "b");
    const fromAlias = await identityCluster("b");
    expect(fromAlias.primaryId).toBe("a");
    expect(fromAlias.emails.sort()).toEqual(["a@x.com", "b@x.com"]);
  });

  it("linking a profile that has its own aliases brings the whole cluster over", async () => {
    await linkCustomers("t1", "b", "c"); // b ← c
    await linkCustomers("t1", "a", "b"); // a ← (b, c)
    const c = await identityCluster("c");
    expect(c.primaryId).toBe("a");
    expect(c.emails.sort()).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
  });

  it("unlinking an alias detaches only that alias", async () => {
    await linkCustomers("t1", "a", "b");
    await linkCustomers("t1", "a", "c");
    await unlinkCustomer("t1", "c");
    expect((await identityCluster("a")).emails.sort()).toEqual(["a@x.com", "b@x.com"]);
    expect((await identityCluster("c")).emails).toEqual(["c@x.com"]);
  });

  it("unlinking the primary promotes the oldest alias for the rest", async () => {
    await linkCustomers("t1", "a", "b");
    await linkCustomers("t1", "a", "c");
    await unlinkCustomer("t1", "a");
    const b = await identityCluster("b");
    expect(b.primaryId).toBe("b");
    expect(b.emails.sort()).toEqual(["b@x.com", "c@x.com"]);
    expect((await identityCluster("a")).emails).toEqual(["a@x.com"]);
  });

  it("re-linking the same cluster is a no-op", async () => {
    await linkCustomers("t1", "a", "b");
    await linkCustomers("t1", "b", "a");
    const c = await identityCluster("a");
    expect(c.members).toHaveLength(2);
    expect(c.primaryId).toBe("a");
  });
});
