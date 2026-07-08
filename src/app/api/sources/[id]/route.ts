import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { requireAdmin } from "@/lib/roles";

/** Toggle / annotate a sales source (admin). Credentials are env-managed. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }
  const { id } = await params;
  const tenant = await getCurrentTenant();
  const source = await prisma.salesSource.findFirst({ where: { id, tenantId: tenant.id } });
  if (!source) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { active?: boolean; notes?: string };
  const data: { active?: boolean; notes?: string } = {};
  if (typeof body.active === "boolean") data.active = body.active;
  if (typeof body.notes === "string") data.notes = body.notes;
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  await prisma.salesSource.update({ where: { id }, data });
  await prisma.auditEvent.create({
    data: { tenantId: tenant.id, actorId: admin.id, action: "sales_source_updated", entity: `source:${id}`, meta: { key: source.key, ...data } },
  });
  return NextResponse.json({ ok: true });
}
