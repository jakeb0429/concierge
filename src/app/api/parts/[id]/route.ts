import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { sessionUser } from "@/lib/roles";
import { parseBody } from "@/lib/validate";

/** Edit an arm SKU's counts / metadata (e.g. decrement after shipping a
 *  replacement). Any signed-in staff may manage arm stock. */
const bodySchema = z.object({
  leftCount: z.number().int().min(0).max(100000).optional(),
  rightCount: z.number().int().min(0).max(100000).optional(),
  brand: z.string().trim().min(1).max(60).optional(),
  container: z.number().int().min(0).max(9999).nullable().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await sessionUser();
  if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await params;
  const tenant = await getCurrentTenant();

  const row = await prisma.armInventory.findFirst({ where: { id, tenantId: tenant.id } });
  if (!row) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const body = await parseBody(req, bodySchema);
  if (body instanceof NextResponse) return body;

  const data: { leftCount?: number; rightCount?: number; brand?: string; container?: number | null } = {};
  if (body.leftCount !== undefined) data.leftCount = body.leftCount;
  if (body.rightCount !== undefined) data.rightCount = body.rightCount;
  if (body.brand !== undefined) data.brand = body.brand;
  if (body.container !== undefined) data.container = body.container;
  if (Object.keys(data).length === 0)
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  await prisma.armInventory.update({ where: { id }, data });
  await prisma.auditEvent.create({
    data: {
      tenantId: tenant.id,
      actorId: actor.id,
      action: "arm_count_updated",
      entity: `arm:${id}`,
      meta: {
        sku: row.sku,
        ...(data.leftCount !== undefined ? { leftFrom: row.leftCount, leftTo: data.leftCount } : {}),
        ...(data.rightCount !== undefined ? { rightFrom: row.rightCount, rightTo: data.rightCount } : {}),
        ...(data.brand !== undefined ? { brandTo: data.brand } : {}),
      },
    },
  });
  return NextResponse.json({ ok: true });
}
