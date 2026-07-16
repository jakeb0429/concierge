import { prisma } from "@/lib/db";

/**
 * Associated customer profiles — the same person under multiple email
 * addresses (personal gmail vs the address they registered the boat with,
 * spouse's shared inbox, work email).
 *
 * Model: aliases carry `primaryId` pointing at one primary profile; the
 * primary's own primaryId is null. A "cluster" is the primary plus all its
 * aliases, and identity-based lookups expand across every email in it.
 */

export type ClusterMember = {
  id: string;
  email: string | null;
  displayName: string | null;
  isPrimary: boolean;
};

/** Resolve the full cluster for a customer (works from any member). */
export async function identityCluster(customerId: string): Promise<{
  primaryId: string;
  members: ClusterMember[];
  emails: string[];
}> {
  const self = await prisma.customer.findUniqueOrThrow({
    where: { id: customerId },
    select: { id: true, primaryId: true },
  });
  const primaryId = self.primaryId ?? self.id;
  const members = await prisma.customer.findMany({
    where: { OR: [{ id: primaryId }, { primaryId }] },
    select: { id: true, email: true, displayName: true, primaryId: true },
    orderBy: { createdAt: "asc" },
  });
  return {
    primaryId,
    members: members.map((m) => ({
      id: m.id,
      email: m.email,
      displayName: m.displayName,
      isPrimary: m.id === primaryId,
    })),
    emails: [...new Set(members.map((m) => m.email?.toLowerCase()).filter((e): e is string => !!e))],
  };
}

/** Emails to search orders/boats under, for any member of the cluster. */
export async function clusterEmails(customerId: string): Promise<string[]> {
  try {
    return (await identityCluster(customerId)).emails;
  } catch {
    return [];
  }
}

/**
 * Associate two profiles. The cluster containing `intoId` keeps its primary;
 * `otherId`'s whole cluster (it may be a primary with its own aliases) is
 * re-pointed at that primary. Tenant-checked; linking across tenants throws.
 */
export async function linkCustomers(tenantId: string, intoId: string, otherId: string): Promise<void> {
  if (intoId === otherId) return;
  const [a, b] = await Promise.all([
    prisma.customer.findFirstOrThrow({ where: { id: intoId, tenantId }, select: { id: true, primaryId: true } }),
    prisma.customer.findFirstOrThrow({ where: { id: otherId, tenantId }, select: { id: true, primaryId: true } }),
  ]);
  const primaryId = a.primaryId ?? a.id;
  const otherPrimary = b.primaryId ?? b.id;
  if (otherPrimary === primaryId) return; // already one cluster
  // Re-point the other primary and every alias under it.
  await prisma.customer.updateMany({
    where: { tenantId, OR: [{ id: otherPrimary }, { primaryId: otherPrimary }], NOT: { id: primaryId } },
    data: { primaryId },
  });
}

/** Detach one profile from its cluster (it becomes standalone). */
export async function unlinkCustomer(tenantId: string, customerId: string): Promise<void> {
  const self = await prisma.customer.findFirstOrThrow({
    where: { id: customerId, tenantId },
    select: { id: true, primaryId: true },
  });
  if (self.primaryId) {
    await prisma.customer.update({ where: { id: customerId }, data: { primaryId: null } });
    return;
  }
  // Detaching the PRIMARY: promote the oldest alias to primary for the rest.
  const aliases = await prisma.customer.findMany({
    where: { tenantId, primaryId: customerId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!aliases.length) return;
  const [newPrimary, ...rest] = aliases;
  await prisma.customer.update({ where: { id: newPrimary.id }, data: { primaryId: null } });
  if (rest.length)
    await prisma.customer.updateMany({
      where: { id: { in: rest.map((r) => r.id) } },
      data: { primaryId: newPrimary.id },
    });
}
