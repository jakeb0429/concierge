import { cache } from "react";
import { unstable_cache } from "next/cache";
import { prisma } from "./db";
import { auth } from "./auth";

/**
 * Current tenant resolver — reads the signed-in user's tenant from the
 * session. Scripts and unauthenticated contexts fall back to Rheos (the
 * original single-tenant behavior), so nothing breaks outside a request.
 *
 * Tenant rows are cached 60s (the DB is a 175ms round trip away and this
 * runs on EVERY page). The row may be up to a minute stale — read-modify-
 * write flows (e.g. appending to voiceGuide) must re-read fresh from prisma
 * before writing, never trust this copy.
 */
const tenantById = unstable_cache(
  async (id: string) =>
    prisma.tenant.findUnique({ where: { id }, select: { id: true, slug: true, name: true, voiceGuide: true } }),
  ["tenant-by-id"],
  { revalidate: 60 }
);
const tenantRheos = unstable_cache(
  async () =>
    prisma.tenant.findUniqueOrThrow({
      where: { slug: "rheos" },
      select: { id: true, slug: true, name: true, voiceGuide: true },
    }),
  ["tenant-rheos"],
  { revalidate: 60 }
);

export const getCurrentTenant = cache(async () => {
  const session = await auth().catch(() => null);
  if (session?.user?.tenantId) {
    const t = await tenantById(session.user.tenantId);
    if (t) return t;
  }
  return tenantRheos();
});
