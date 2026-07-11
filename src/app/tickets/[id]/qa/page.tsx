import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { sessionUser } from "@/lib/roles";
import { cleanEmailText } from "@/lib/email-clean";
import QuestionsPanel from "@/app/components/QuestionsPanel";

export const dynamic = "force-dynamic";

const label = (u: { name: string | null; email: string }) => u.name ?? u.email.split("@")[0];

/**
 * The Simple View of a ticket: who's asking, what the team wants to know, and
 * the email thread if you need context — and nothing else. No drafts, no AI,
 * no Brain. Opening this page never triggers a draft generation.
 */
export default async function TicketQA({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [tenant, me] = await Promise.all([getCurrentTenant(), sessionUser()]);
  const ticket = await prisma.ticket.findFirst({
    where: { id, tenantId: tenant.id },
    select: {
      id: true,
      subject: true,
      createdAt: true,
      customer: { select: { displayName: true } },
      channelRef: { select: { supportAddress: true } },
      messages: {
        orderBy: { sentAt: "asc" },
        select: { id: true, direction: true, text: true, sentAt: true, attachments: true },
      },
    },
  });
  if (!ticket) notFound();

  const [questions, users, reviewDraft] = await Promise.all([
    prisma.ticketQuestion.findMany({
      where: { ticketId: ticket.id, tenantId: tenant.id },
      include: {
        askedBy: { select: { name: true, email: true } },
        assignee: { select: { name: true, email: true } },
        replies: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true, email: true } } } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.user.findMany({
      where: { tenantId: tenant.id },
      select: { id: true, email: true, name: true },
      orderBy: { email: "asc" },
    }),
    // The reply the CS team has queued up, once it's in the review pipeline —
    // so an answering teammate can see what's about to go out. Never a raw
    // work-in-progress draft, and read-only here.
    prisma.draft.findFirst({
      where: { ticketId: id, tenantId: tenant.id, status: { in: ["pending_review", "approved"] } },
      orderBy: { createdAt: "desc" },
      select: { body: true, editedBody: true, status: true },
    }),
  ]);

  const fmtTime = (d: Date) =>
    d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <div>
      <Link href="/questions" className="text-sm text-neutral-500 hover:text-neutral-900">
        ← Questions
      </Link>

      {/* who this is about — bare minimum context */}
      <div className="mb-3 mt-3 rounded-xl border border-neutral-200 bg-white px-4 py-3">
        <p className="text-sm font-medium text-neutral-800">{ticket.customer.displayName ?? "Customer"}</p>
        <p className="text-sm text-neutral-600">{ticket.subject || "(no subject)"}</p>
        <p className="mt-0.5 text-xs text-neutral-400">
          wrote in {fmtTime(ticket.createdAt)}
          {ticket.channelRef?.supportAddress ? ` · via ${ticket.channelRef.supportAddress}` : ""}
        </p>
      </div>

      <QuestionsPanel
        ticketId={ticket.id}
        meId={me?.id ?? null}
        users={users.map((u) => ({ id: u.id, label: u.name ?? u.email.split("@")[0] }))}
        questions={questions.map((q) => ({
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
        }))}
      />

      {/* the reply the CS team queued up, once a manager is reviewing it */}
      {reviewDraft && (
        <div className="mb-3 rounded-xl border border-neutral-200 bg-white p-4">
          <div className="mb-2 flex items-baseline gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-warm-grey">Draft reply</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] ${reviewDraft.status === "approved" ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
              {reviewDraft.status === "approved" ? "approved — not sent yet" : "awaiting review"}
            </span>
            <span className="text-[11px] text-neutral-400">the customer team sends this, not you</span>
          </div>
          <p className="whitespace-pre-wrap text-sm text-neutral-700">{reviewDraft.editedBody ?? reviewDraft.body}</p>
        </div>
      )}

      {/* the customer conversation, only if you want the context */}
      <details className="rounded-xl border border-neutral-200 bg-white">
        <summary className="cursor-pointer px-4 py-2.5 text-sm text-neutral-600 hover:text-neutral-900">
          Show the email conversation ({ticket.messages.length} message{ticket.messages.length !== 1 ? "s" : ""})
        </summary>
        <div className="space-y-3 border-t border-neutral-100 px-4 py-3">
          {ticket.messages.map((m) => {
            const atts = ((m.attachments as { filename: string; mimeType: string | null }[] | null) ?? []).map(
              (a, i) => ({ index: i, filename: a.filename, isImage: (a.mimeType ?? "").startsWith("image/") })
            );
            return (
              <div key={m.id} className={`rounded-lg px-3 py-2 ${m.direction === "inbound" ? "bg-blue-50/50" : "bg-neutral-50"}`}>
                <p className="mb-1 text-[11px] text-neutral-400">
                  {m.direction === "inbound" ? "Customer" : "Our reply"} · {fmtTime(m.sentAt)}
                </p>
                <p className="whitespace-pre-wrap text-sm text-neutral-700">{cleanEmailText(m.text)}</p>
                {atts.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {atts.map((a) =>
                      a.isImage ? (
                        <a key={a.index} href={`/api/attachments/${m.id}/${a.index}`} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element -- bytes stream from the mailbox, size unknown */}
                          <img
                            src={`/api/attachments/${m.id}/${a.index}`}
                            alt={a.filename}
                            className="max-h-40 rounded-lg border border-neutral-200 object-cover"
                          />
                        </a>
                      ) : (
                        <a
                          key={a.index}
                          href={`/api/attachments/${m.id}/${a.index}`}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg border border-neutral-200 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
                        >
                          📎 {a.filename}
                        </a>
                      )
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}
