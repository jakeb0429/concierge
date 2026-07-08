import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { cleanEmailText } from "@/lib/email-clean";
import { computeReplyState } from "@/lib/reply-state";
import { categoryLabel } from "@/lib/categories";
import { getCustomerInsight } from "@/lib/customer-insight";
import { notesForTicket } from "@/lib/notes";
import { getCurrentTenant } from "@/lib/tenant";
import TicketWorkspace from "./TicketWorkspace";

export const dynamic = "force-dynamic";

export default async function TicketDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await getCurrentTenant();
  // Scoped to the signed-in brand — a Stingray user can't open a Rheos URL.
  const ticket = await prisma.ticket.findFirst({
    where: { id, tenantId: tenant.id },
    include: {
      customer: true,
      channelRef: true,
      messages: {
        orderBy: { sentAt: "asc" },
        // html is never rendered (cleanEmailText uses text) and is 2-10x the size
        select: { id: true, direction: true, subject: true, text: true, sentAt: true, attachments: true },
      },
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
  const [orderAgg, refundCount, inquiryCounts, ticketCount, tenantUsers] = await Promise.all([
    email
      ? prisma.customerOrder.aggregate({
          where: { email, tenantId: tenant.id },
          _count: true,
          _sum: { totalAmount: true },
          _min: { orderedAt: true },
          _max: { orderedAt: true },
        })
      : Promise.resolve(null),
    email ? prisma.customerOrder.count({ where: { email, refunded: true, tenantId: tenant.id } }) : Promise.resolve(0),
    email
      ? prisma.analyticsInquiry.groupBy({ by: ["category"], where: { fromEmail: email, tenantId: tenant.id }, _count: true })
      : Promise.resolve([]),
    prisma.ticket.count({ where: { customerId: ticket.customer.id } }),
    // ShipStation order context deliberately NOT fetched here — it can take
    // seconds and used to block first paint; the workspace loads it client-side.
    prisma.user.findMany({
      where: { tenantId: ticket.tenantId },
      select: { id: true, email: true, name: true },
      orderBy: { email: "asc" },
    }),
  ]);
  // AI customer read (cached; stale reads refresh AFTER the response) + notes.
  const [customerInsight, contextNotes] = await Promise.all([
    getCustomerInsight(ticket.customer.id).catch(() => null),
    notesForTicket(ticket.tenantId, ticket.id, ticket.customer.id),
  ]);
  const replyState = computeReplyState(ticket.messages);
  const inqTotal = inquiryCounts.reduce((s, c) => s + c._count, 0) + ticketCount;

  // Deep link to the original conversation in Gmail. NOTE: /mail/u/ takes an
  // account INDEX, not an address (an address there 404s) — ?authuser=<email>
  // is the form Gmail resolves to the right signed-in account.
  const mailbox = ticket.channelRef?.supportAddress ?? "hello@rheosgear.com";
  const gmailUrl =
    ticket.channel === "gmail" && !ticket.providerThreadId.startsWith("mock-")
      ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(mailbox)}#all/${ticket.providerThreadId}`
      : null;
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
          mailbox,
          categoryLabel: ticket.category ? categoryLabel(ticket.category) : null,
        }}
        assign={{
          assigneeId: ticket.assigneeId,
          users: tenantUsers.map((u) => ({ id: u.id, label: u.name ?? u.email.split("@")[0] })),
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
        contextNotes={contextNotes.map((n) => ({ ...n, expiresAt: n.expiresAt?.toISOString() ?? null }))}
        customerInsight={customerInsight}
        purchaseChannel={
          ticket.customer.purchaseChannel
            ? `${ticket.customer.purchaseChannel}${ticket.customer.channelName ? ` · ${ticket.customer.channelName}` : ""}`
            : null
        }
        replyState={replyState}
        gmailUrl={gmailUrl}
      />
    </div>
  );
}
