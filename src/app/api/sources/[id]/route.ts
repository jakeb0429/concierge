import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { requireAdmin } from "@/lib/roles";
import { parseBody } from "@/lib/validate";

const bodySchema = z.object({
  active: z.boolean().optional(),
  notes: z.string().optional(),
});

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

  const body = await parseBody(req, bodySchema);
  if (body instanceof NextResponse) return body;
  const data: { active?: boolean; notes?: string } = {};
  if (body.active !== undefined) data.active = body.active;
  if (body.notes !== undefined) data.notes = body.notes;
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  await prisma.salesSource.update({ where: { id }, data });
  await prisma.auditEvent.create({
    data: { tenantId: tenant.id, actorId: admin.id, action: "sales_source_updated", entity: `source:${id}`, meta: { key: source.key, ...data } },
  });
  return NextResponse.json({ ok: true });
}
