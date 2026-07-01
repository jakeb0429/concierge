import { prisma } from "./db";

/**
 * Current tenant resolver. Auth (magic-link + agent/admin) is deferred for the
 * Phase-0 loop build — everything runs as the Rheos tenant. When auth lands, this
 * reads the tenant from the session instead.
 */
export async function getCurrentTenant() {
  return prisma.tenant.findUniqueOrThrow({ where: { slug: "rheos" } });
}
