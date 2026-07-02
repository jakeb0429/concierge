import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { cleanEmailText } from "@/lib/email-clean";
import { computeReplyState } from "@/lib/reply-state";
import { getOrderContext, orderContextLines, trackingUrl } from "@/lib/shipstation";
import TicketWorkspace from "./TicketWorkspace";

export const dynamic = "force-dynamic";

export default async function TicketDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: {
      customer: true,
      channelRef: true,
      messages: { orderBy: { sentAt: "asc" } },
      drafts: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          citations: {
            include: { knowledgeItem: { select: { id: true, title: true, sourceRef: true, version: true } } },
          },
        },
      },
    },
  });
  if (!ticket) notFound();

  // Customer key stats — orders, spend, returns, and support history at a glance.
  const email = ticket.customer.email?.toLowerCase();
  const [orderAgg, refundCount, inquiryCounts, ticketCount, shipOrders] = await Promise.all([
    email
      ? prisma.customerOrder.aggregate({
          where: { email },
          _count: true,
          _sum: { totalAmount: true },
          _min: { orderedAt: true },
          _max: { orderedAt: true },
        })
      : Promise.resolve(null),
    email ? prisma.customerOrder.count({ where: { email, refunded: true } }) : Promise.resolve(0),
    email
      ? prisma.analyticsInquiry.groupBy({ by: ["category"], where: { fromEmail: email }, _count: true })
      : Promise.resolve([]),
    prisma.ticket.count({ where: { customerId: ticket.customer.id } }),
    getOrderContext(email), // ShipStation: placed / shipped / carrier / tracking (cached, fail-soft)
  ]);
  const orderContext = orderContextLines(shipOrders).map((line, i) => ({
    line,
    trackingUrl: trackingUrl(shipOrders[i].carrier, shipOrders[i].trackingNumber),
  }));
  const replyState = computeReplyState(ticket.messages);
  const inqTotal = inquiryCounts.reduce((s, c) => s + c._count, 0) + ticketCount;
  const customerStats = {
    orders: orderAgg?._count ?? 0,
    totalSpend: Number(orderAgg?._sum.totalAmount ?? 0),
    firstSale: orderAgg?._min.orderedAt?.toISOString() ?? null,
    lastSale: orderAgg?._max.orderedAt?.toISOString() ?? null,
    returns: refundCount,
    warrantyContacts: inquiryCounts.find((c) => c.category === "warranty")?._count ?? 0,
    returnContacts: inquiryCounts.find((c) => c.category === "returns_exchange")?._count ?? 0,
    totalInquiries: inqTotal,
  };

  const latest = ticket.drafts[0];
  const sentDraftId = latest?.status === "sent" ? latest.id : null;
  const initialDraft =
    latest && latest.status !== "sent"
      ? {
          draftId: latest.id,
          body: latest.editedBody ?? latest.body,
          coverage: latest.coverage,
          coverageNote: latest.coverageNote,
          policyFlags: latest.policyFlags,
          status: latest.status,
          reviewNote: latest.reviewNote,
          citations: latest.citations.map((c) => ({
            id: c.knowledgeItem.id,
            title: c.knowledgeItem.title,
            score: c.score,
            sourceRef: c.knowledgeItem.sourceRef,
            version: c.knowledgeItem.version,
          })),
        }
      : null;

  return (
    <div>
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">
        ← Inbox
      </Link>
      <TicketWorkspace
        ticket={{
          id: ticket.id,
          subject: ticket.subject ?? "",
          status: ticket.status,
          priority: ticket.priority,
          customerId: ticket.customer.id,
          customerName: ticket.customer.displayName ?? "Customer",
          customerEmail: ticket.customer.email ?? "",
          mailbox: ticket.channelRef?.supportAddress ?? "hello@rheosgear.com",
        }}
        messages={ticket.messages.map((m) => ({
          id: m.id,
          direction: m.direction,
          subject: m.subject,
          text: cleanEmailText(m.text),
          sentAt: m.sentAt.toISOString(),
          attachments: ((m.attachments as { filename: string; mimeType: string }[] | null) ?? []).map(
            (a, i) => ({ index: i, filename: a.filename, isImage: a.mimeType.startsWith("image/") })
          ),
        }))}
        initialDraft={initialDraft}
        sentDraftId={sentDraftId}
        customerStats={customerStats}
        replyState={replyState}
        orderContext={orderContext}
      />
    </div>
  );
}
