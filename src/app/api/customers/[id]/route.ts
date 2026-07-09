import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { sessionUser } from "@/lib/roles";
import { parseBody } from "@/lib/validate";

// null clears a fact; omitting the key leaves it untouched.
const bodySchema = z.object({
  purchaseChannel: z.enum(["direct", "retail", "dealer"]).nullable().optional(),
  channelName: z.string().nullable().optional(),
});

/** Rep-maintained purchase-channel facts — the things no data feed can see
 *  (which dealer sold the boat, that they buy at a local retailer). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await getCurrentTenant();
  const customer = await prisma.customer.findFirst({ where: { id, tenantId: tenant.id } });
  if (!customer) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const body = await parseBody(req, bodySchema);
  if (body instanceof NextResponse) return body;
  const data: { purchaseChannel?: string | null; channelName?: string | null } = {};
  if (body.purchaseChannel !== undefined) data.purchaseChannel = body.purchaseChannel;
  if (body.channelName !== undefined) data.channelName = body.channelName?.trim() || null;
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  await prisma.customer.update({ where: { id }, data });
  const actor = await sessionUser();
  await prisma.auditEvent.create({
    data: { tenantId: tenant.id, actorId: actor?.id, action: "customer_channel_updated", entity: `customer:${id}`, meta: data },
  });
  return NextResponse.json({ ok: true });
}
