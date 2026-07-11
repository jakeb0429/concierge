import { NextResponse } from "next/server";
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { getOrderContext } from "@/lib/shipstation";
import { getCustomerInsight } from "@/lib/customer-insight";
import { priorityWeight } from "@/lib/priority";

/**
 * The next ticket to work: oldest open ticket still awaiting a reply,
 * excluding the current one. Called when a workspace opens, so it ALSO
 * pre-warms the next ticket's slow dependencies (ShipStation order cache +
 * customer read) in the background — by the time the rep clicks "Next →",
 * the expensive parts are already hot.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await getCurrentTenant();

  const candidates = await prisma.ticket.findMany({
    where: { tenantId: tenant.id, id: { not: id }, status: { notIn: ["archived", "resolved", "replied"] } },
    select: {
      id: true,
      subject: true,
      priority: true,
      createdAt: true,
      customerId: true,
      customer: { select: { email: true } },
      messages: { orderBy: { sentAt: "desc" }, take: 1, select: { direction: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  const needing = candidates.filter((t) => t.messages[0]?.direction === "inbound");
  // Most urgent first, then longest-waiting — same priority order as the inbox.
  needing.sort((a, b) => priorityWeight(b.priority) - priorityWeight(a.priority) || a.createdAt.getTime() - b.createdAt.getTime());
  const next = needing[0];
  if (!next) return NextResponse.json({ next: null });

  after(async () => {
    // Fire-and-forget cache warming — failures are irrelevant here.
    await Promise.allSettled([getOrderContext(next.customer.email, tenant.id), getCustomerInsight(next.customerId)]);
  });

  return NextResponse.json({ next: { id: next.id, subject: next.subject, urgent: next.priority === "urgent" } });
}
