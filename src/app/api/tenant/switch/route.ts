import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { unstable_update } from "@/lib/auth";
import { sessionUser } from "@/lib/roles";

/**
 * Switch the session to another tenant where this email is provisioned
 * (e.g. jake@scribechs.com is an admin on both Rheos and Stingray). The jwt
 * callback re-verifies the target row before rewriting the token.
 */
export async function POST(req: Request) {
  const u = await sessionUser();
  if (!u) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { tenantSlug } = (await req.json().catch(() => ({}))) as { tenantSlug?: string };
  if (!tenantSlug) return NextResponse.json({ error: "tenantSlug required." }, { status: 400 });

  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) return NextResponse.json({ error: "Unknown tenant." }, { status: 404 });
  const target = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email: u.email } },
  });
  if (!target) return NextResponse.json({ error: "No access to that brand." }, { status: 403 });

  await unstable_update({ tenantId: tenant.id } as never);
  return NextResponse.json({ ok: true, tenant: tenant.slug });
}
