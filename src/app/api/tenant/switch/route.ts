import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { unstable_update } from "@/lib/auth";
import { sessionUser } from "@/lib/roles";
import { parseBody } from "@/lib/validate";

const bodySchema = z.object({ tenantSlug: z.string().min(1) });

/**
 * Switch the session to another tenant where this email is provisioned
 * (e.g. jake@scribechs.com is an admin on both Rheos and Stingray). The jwt
 * callback re-verifies the target row before rewriting the token.
 */
export async function POST(req: Request) {
  const u = await sessionUser();
  if (!u) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = await parseBody(req, bodySchema);
  if (parsed instanceof NextResponse) return parsed;
  const { tenantSlug } = parsed;

  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) return NextResponse.json({ error: "Unknown tenant." }, { status: 404 });
  const target = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email: u.email } },
  });
  if (!target) return NextResponse.json({ error: "No access to that brand." }, { status: 403 });

  await unstable_update({ tenantId: tenant.id } as never);
  return NextResponse.json({ ok: true, tenant: tenant.slug });
}
