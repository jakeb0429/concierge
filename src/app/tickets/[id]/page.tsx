import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { cleanEmailText } from "@/lib/email-clean";
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
        include: { citations: { include: { knowledgeItem: { select: { id: true, title: true } } } } },
      },
    },
  });
  if (!ticket) notFound();

  const latest = ticket.drafts[0];
  const initialDraft =
    latest && latest.status !== "sent"
      ? {
          draftId: latest.id,
          body: latest.editedBody ?? latest.body,
          coverage: latest.coverage,
          coverageNote: latest.coverageNote,
          policyFlags: [] as string[],
          citations: latest.citations.map((c) => ({
            id: c.knowledgeItem.id,
            title: c.knowledgeItem.title,
            score: c.score,
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
          customerName: ticket.customer.displayName ?? "Customer",
          customerEmail: ticket.customer.email ?? "",
          mailbox: ticket.channelRef?.supportAddress ?? "hello@rheosgear.com",
        }}
        messages={ticket.messages.map((m) => ({
          direction: m.direction,
          subject: m.subject,
          text: cleanEmailText(m.text),
          sentAt: m.sentAt.toISOString(),
        }))}
        initialDraft={initialDraft}
      />
    </div>
  );
}
