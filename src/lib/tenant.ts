import { prisma } from "./db";
import { auth } from "./auth";

/**
 * Current tenant resolver — reads the signed-in user's tenant from the
 * session. Scripts and unauthenticated contexts fall back to Rheos (the
 * original single-tenant behavior), so nothing breaks outside a request.
 */
export async function getCurrentTenant() {
  const session = await auth().catch(() => null);
  if (session?.user?.tenantId) {
    const t = await prisma.tenant.findUnique({ where: { id: session.user.tenantId } });
    if (t) return t;
  }
  return prisma.tenant.findUniqueOrThrow({ where: { slug: "rheos" } });
}
