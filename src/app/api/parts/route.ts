import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { sessionUser } from "@/lib/roles";
import { parseBody } from "@/lib/validate";

/** Add a new arm SKU to the parts inventory. Any signed-in staff may manage
 *  arm stock (reps run the warranty desk). */
const bodySchema = z.object({
  sku: z.string().trim().min(1).max(40),
  brand: z.string().trim().min(1).max(60),
  container: z.number().int().min(0).max(9999).nullable().optional(),
  leftCount: z.number().int().min(0).max(100000).optional(),
  rightCount: z.number().int().min(0).max(100000).optional(),
});

export async function POST(req: Request) {
  const actor = await sessionUser();
  if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const tenant = await getCurrentTenant();
  const body = await parseBody(req, bodySchema);
  if (body instanceof NextResponse) return body;

  const existing = await prisma.armInventory.findFirst({
    where: { tenantId: tenant.id, sku: body.sku },
    select: { id: true },
  });
  if (existing) return NextResponse.json({ error: "That SKU already exists." }, { status: 409 });

  const row = await prisma.armInventory.create({
    data: {
      tenantId: tenant.id,
      sku: body.sku,
      brand: body.brand,
      container: body.container ?? null,
      leftCount: body.leftCount ?? 0,
      rightCount: body.rightCount ?? 0,
    },
  });
  await prisma.auditEvent.create({
    data: {
      tenantId: tenant.id,
      actorId: actor.id,
      action: "arm_sku_added",
      entity: `arm:${row.id}`,
      meta: { sku: row.sku, brand: row.brand, leftCount: row.leftCount, rightCount: row.rightCount },
    },
  });
  return NextResponse.json({ ok: true, id: row.id });
}
