import { PrismaClient } from "@prisma/client";
import { getOrderContext } from "../src/lib/shipstation";

/**
 * Likely-handled detector — finds open tickets whose ask probably already
 * happened outside the inbox, so the team stops treating them as open work:
 *
 *   · an order SHIPPED after the ticket came in (address changes, "where is
 *     my order", cancel-before-ship asks — the Jerry Treem case)
 *   · a NEW ORDER was placed after the ticket (replacement/warranty asks)
 *   · the customer's latest order shows REFUNDED (return/refund asks)
 *
 * Evidence lands as a `maybe_handled` tag + audit event; the inbox shows a
 * teal "possibly handled" chip and the ticket page a banner with the reason.
 * The rep still confirms — this flags, never closes.
 *
 * Usage: tsx prisma/detect-handled.ts   (cron: hourly at :40)
 */

const prisma = new PrismaClient();

async function main() {
  const tenants = await prisma.tenant.findMany({ select: { id: true, slug: true } });
  for (const tenant of tenants) {
    const open = await prisma.ticket.findMany({
      where: { tenantId: tenant.id, status: { in: ["new", "in_review", "drafted"] } },
      include: {
        customer: { select: { email: true } },
        messages: { orderBy: { sentAt: "desc" }, take: 1, select: { direction: true } },
      },
    });
    const needing = open.filter(
      (t) => t.messages[0]?.direction === "inbound" && !t.tags.includes("maybe_handled") && !!t.customer.email
    );
    if (!needing.length) continue;
    console.log(`${tenant.slug}: checking ${needing.length} open needs-reply ticket(s)…`);

    for (const t of needing) {
      const email = t.customer.email!.toLowerCase();
      const evidence: string[] = [];

      // Shipment after the ask (relevant to shipping/address/cancel asks).
      if (["shipping_order_status", "escalation", "other", null].includes(t.category)) {
        const orders = await getOrderContext(email, tenant.id).catch(() => []);
        for (const o of orders) {
          if (o.shipDate && new Date(o.shipDate) > t.createdAt) {
            evidence.push(`order ${o.orderNumber} shipped ${o.shipDate.slice(0, 10)} (after this request came in)`);
          }
        }
      }
      // New order after the ask (replacements, warranty make-goods).
      if (["warranty", "replacement_parts", "returns_exchange", null].includes(t.category)) {
        const newer = await prisma.customerOrder.findFirst({
          where: { email, tenantId: tenant.id, orderedAt: { gt: t.createdAt } },
          orderBy: { orderedAt: "desc" },
        });
        if (newer)
          evidence.push(`a new order (#${newer.orderRef}) was placed ${newer.orderedAt.toISOString().slice(0, 10)}, after this ticket`);
      }
      // Refund shows on their latest order (return/refund asks).
      if (["returns_exchange", "warranty", null].includes(t.category)) {
        const latest = await prisma.customerOrder.findFirst({
          where: { email, tenantId: tenant.id },
          orderBy: { orderedAt: "desc" },
        });
        if (latest?.refunded) evidence.push(`their most recent order (#${latest.orderRef}) shows a refund processed`);
      }

      if (evidence.length) {
        await prisma.ticket.update({ where: { id: t.id }, data: { tags: { push: "maybe_handled" } } });
        await prisma.auditEvent.create({
          data: {
            tenantId: tenant.id,
            action: "ticket_maybe_handled",
            entity: `ticket:${t.id}`,
            meta: { evidence },
          },
        });
        console.log(`  ⚑ ${(t.subject ?? "(no subject)").slice(0, 50)} — ${evidence[0]}`);
      }
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
