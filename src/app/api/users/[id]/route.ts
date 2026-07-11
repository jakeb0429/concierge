import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { requireAdmin } from "@/lib/roles";
import { INQUIRY_CATEGORIES } from "@/lib/categories";
import { parseBody } from "@/lib/validate";

const bodySchema = z.object({
  name: z.string().optional(),
  // super_admin is script-managed — never assignable from the UI.
  role: z.enum(["agent", "team_lead", "brand_admin"]).optional(),
  specialties: z.array(z.enum(INQUIRY_CATEGORIES)).optional(),
  // "simple" lands the user on the Q&A view by default (onboarding mode).
  preferredView: z.enum(["full", "simple"]).optional(),
});

/** Edit a teammate's name, role, or specialties (which tickets auto-route to them). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }
  const { id } = await params;
  const tenant = await getCurrentTenant();
  const user = await prisma.user.findFirst({ where: { id, tenantId: tenant.id } });
  if (!user) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const body = await parseBody(req, bodySchema);
  if (body instanceof NextResponse) return body;
  const data: { name?: string; role?: string; specialties?: string[]; preferredView?: string } = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.role !== undefined) {
    if (id === admin.id) return NextResponse.json({ error: "You can't change your own role." }, { status: 400 });
    if (user.role === "super_admin") return NextResponse.json({ error: "super_admin is script-managed." }, { status: 400 });
    data.role = body.role;
  }
  if (body.specialties !== undefined) data.specialties = [...body.specialties];
  if (body.preferredView !== undefined) data.preferredView = body.preferredView;
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  await prisma.user.update({ where: { id }, data });
  await prisma.auditEvent.create({
    data: { tenantId: tenant.id, actorId: admin.id, action: "user_updated", entity: `user:${id}`, meta: data },
  });
  return NextResponse.json({ ok: true });
}
