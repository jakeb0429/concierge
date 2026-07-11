import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { cleanEmailText } from "@/lib/email-clean";
import { computeReplyState } from "@/lib/reply-state";
import { categoryLabel } from "@/lib/categories";
import { getCustomerInsight } from "@/lib/customer-insight";
import { notesForTicket } from "@/lib/notes";
import { extractProductMention } from "@/lib/product-extract";
import { getCurrentTenant } from "@/lib/tenant";
import { sessionUser } from "@/lib/roles";
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
  // Which product family this ticket is about (deterministic extractor) —
  // drives product-scoped notes and the composer's product option.
  const firstInboundMsg = ticket.messages.find((m) => m.direction === "inbound");
  const pm = await extractProductMention(`${ticket.subject ?? ""}\n${firstInboundMsg?.text ?? ""}`);

  // AI customer read (cached; stale reads refresh AFTER the response) + notes
  // + the audit events that draw the sequence timeline + internal Q&A.
  const [customerInsight, contextNotes, ticketEvents, me, questions] = await Promise.all([
    getCustomerInsight(ticket.customer.id).catch(() => null),
    notesForTicket(ticket.tenantId, ticket.id, ticket.customer.id, pm.productFamily),
    prisma.auditEvent.findMany({
      where: { tenantId: ticket.tenantId, entity: `ticket:${ticket.id}` },
      orderBy: { createdAt: "asc" },
      select: { action: true, createdAt: true, meta: true },
    }),
    sessionUser(),
    prisma.ticketQuestion.findMany({
      where: { ticketId: ticket.id, tenantId: tenant.id },
      include: {
        askedBy: { select: { name: true, email: true } },
        assignee: { select: { name: true, email: true } },
        replies: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true, email: true } } } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  // Sequence: received → assigned → drafted → replied → resolved.
  const fmtStep = (d: Date | null | undefined) =>
    d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;
  const firstEvent = (...actions: string[]) => ticketEvents.find((e) => actions.includes(e.action))?.createdAt ?? null;
  const firstOutbound = ticket.messages.find((m) => m.direction === "outbound");
  const repliedAt = firstOutbound?.sentAt ?? firstEvent("reply_sent", "ticket_replied_external");
  const resolvedAt = ["resolved", "archived"].includes(ticket.status)
    ? (ticketEvents.filter((e) => ["ticket_resolved", "ticket_archived"].includes(e.action)).at(-1)?.createdAt ?? null)
    : null;
  const handledEvidence = ticket.tags.includes("maybe_handled")
    ? (([...ticketEvents].reverse().find((e) => e.action === "ticket_maybe_handled")?.meta as { evidence?: string[] } | null)
        ?.evidence ?? null)
    : null;
  const timeline = [
    { label: "Received", at: fmtStep(ticket.createdAt), done: true },
    {
      label: "Assigned",
      at: fmtStep(firstEvent("auto_assigned", "ticket_reassigned")),
      done: !!ticket.assigneeId || !!firstEvent("auto_assigned", "ticket_reassigned"),
    },
    { label: "Drafted", at: fmtStep(firstEvent("draft_generated")), done: !!firstEvent("draft_generated") },
    { label: "Replied", at: fmtStep(repliedAt), done: !!repliedAt },
    {
      label: ticket.status === "archived" ? "Archived" : "Resolved",
      at: fmtStep(resolvedAt),
      done: ["resolved", "archived"].includes(ticket.status),
    },
  ];
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
          categoryKey: ticket.category,
          returnStatus: ticket.returnStatus,
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
          attachments: ((m.attachments as { filename: string; mimeType: string | null }[] | null) ?? []).map(
            // Old Graph rows can carry a null mimeType — never crash the page on it.
            (a, i) => ({ index: i, filename: a.filename, isImage: (a.mimeType ?? "").startsWith("image/") })
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
        timeline={timeline}
        detectedFamily={pm.productFamily}
        handledEvidence={handledEvidence}
        meId={me?.id ?? null}
        questions={questions.map((q) => {
          const label = (u: { name: string | null; email: string }) => u.name ?? u.email.split("@")[0];
          return {
            id: q.id,
            body: q.body,
            status: q.status,
            askedById: q.askedById,
            askedByLabel: label(q.askedBy),
            assigneeId: q.assigneeId,
            assigneeLabel: q.assignee ? label(q.assignee) : null,
            createdAt: q.createdAt.toISOString(),
            replies: q.replies.map((r) => ({
              id: r.id,
              authorId: r.authorId,
              authorLabel: label(r.author),
              body: r.body,
              createdAt: r.createdAt.toISOString(),
            })),
          };
        })}
      />
    </div>
  );
}
