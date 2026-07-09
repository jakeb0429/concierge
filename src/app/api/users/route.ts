import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { requireAdmin } from "@/lib/roles";
import { INQUIRY_CATEGORIES } from "@/lib/categories";
import { parseBody } from "@/lib/validate";

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().refine((v) => v.includes("@"), "Valid email required."),
  name: z.string().optional(),
  // super_admin is script-managed — never assignable from the UI.
  role: z.enum(["agent", "team_lead", "brand_admin"]).default("agent"),
  specialties: z.array(z.enum(INQUIRY_CATEGORIES)).default([]),
});

/** Add a teammate. The User row IS the sign-in grant (magic link). */
export async function POST(req: Request) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }
  const tenant = await getCurrentTenant();
  const body = await parseBody(req, bodySchema);
  if (body instanceof NextResponse) return body;
  const { email, role, specialties } = body;

  // Adding is CREATE-only — an existing teammate is edited via PATCH, which
  // carries the role-change guards (no self-demotion, no super_admin edits).
  const existing = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email } },
  });
  if (existing)
    return NextResponse.json({ error: "That teammate already exists — edit them in the list below." }, { status: 409 });
  const user = await prisma.user.create({
    data: { tenantId: tenant.id, email, name: body.name || null, role, specialties },
  });
  await prisma.auditEvent.create({
    data: { tenantId: tenant.id, action: "user_provisioned", entity: `user:${user.id}`, meta: { email, role, specialties } },
  });
  return NextResponse.json({ ok: true, id: user.id });
}
