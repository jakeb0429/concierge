import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { requireAdmin } from "@/lib/roles";
import { INQUIRY_CATEGORIES } from "@/lib/categories";

const ASSIGNABLE_ROLES = new Set(["agent", "team_lead", "brand_admin"]);

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

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    role?: string;
    specialties?: unknown;
  };
  const data: { name?: string; role?: string; specialties?: string[] } = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.role !== undefined) {
    if (!ASSIGNABLE_ROLES.has(body.role)) return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    if (id === admin.id) return NextResponse.json({ error: "You can't change your own role." }, { status: 400 });
    if (user.role === "super_admin") return NextResponse.json({ error: "super_admin is script-managed." }, { status: 400 });
    data.role = body.role;
  }
  if (body.specialties !== undefined) {
    const set = new Set(INQUIRY_CATEGORIES as readonly string[]);
    if (!Array.isArray(body.specialties) || !body.specialties.every((s) => typeof s === "string" && set.has(s)))
      return NextResponse.json({ error: "Invalid specialties." }, { status: 400 });
    data.specialties = body.specialties;
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  await prisma.user.update({ where: { id }, data });
  await prisma.auditEvent.create({
    data: { tenantId: tenant.id, actorId: admin.id, action: "user_updated", entity: `user:${id}`, meta: data },
  });
  return NextResponse.json({ ok: true });
}
