import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { getOrderContext, orderContextLines, trackingUrl } from "@/lib/shipstation";

/**
 * Live order status for the ticket workspace. Fetched from the client AFTER
 * the page paints — ShipStation can take seconds (8s timeout) and used to
 * block the whole ticket render. Cached 10 min per email in-process.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await getCurrentTenant();
  const ticket = await prisma.ticket.findFirst({
    where: { id, tenantId: tenant.id },
    select: { customer: { select: { email: true } } },
  });
  if (!ticket) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const orders = await getOrderContext(ticket.customer.email);
  return NextResponse.json({
    orderContext: orderContextLines(orders).map((line, i) => ({
      line,
      trackingUrl: trackingUrl(orders[i].carrier, orders[i].trackingNumber),
    })),
  });
}
