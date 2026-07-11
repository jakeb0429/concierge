import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { sessionUser } from "@/lib/roles";

export const dynamic = "force-dynamic";

const label = (u: { name: string | null; email: string } | null) =>
  u ? (u.name ?? u.email.split("@")[0]) : "anyone";
const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

type QRow = {
  id: string;
  body: string;
  status: string;
  createdAt: Date;
  askedBy: { name: string | null; email: string };
  assignee: { name: string | null; email: string } | null;
  ticket: { id: string; subject: string | null; customer: { displayName: string | null } };
  replies: { id: string }[];
};

function QuestionList({ rows, empty }: { rows: QRow[]; empty: string }) {
  if (rows.length === 0)
    return (
      <div className="px-4 py-10 text-center">
        <p className="empty-title">All clear</p>
        <p className="mt-1 text-sm text-neutral-400">{empty}</p>
      </div>
    );
  return (
    <div className="divide-y divide-neutral-100">
      {rows.map((q) => (
        <Link key={q.id} href={`/tickets/${q.ticket.id}/qa`} className="block px-4 py-3 hover:bg-neutral-50">
          <p className="text-sm text-neutral-800">{q.body}</p>
          <p className="mt-1 text-xs text-neutral-400">
            {q.ticket.customer.displayName ?? "Customer"} — {q.ticket.subject || "(no subject)"} · asked by{" "}
            {label(q.askedBy)} for {label(q.assignee)} · {fmt(q.createdAt)}
            {q.replies.length > 0 ? ` · ${q.replies.length} repl${q.replies.length === 1 ? "y" : "ies"}` : ""}
          </p>
        </Link>
      ))}
    </div>
  );
}

/**
 * The Simple View's home: every internal question waiting on you, plus the
 * ones you asked. Answer from here without ever touching the full workspace.
 */
export default async function Questions() {
  const [tenant, me] = await Promise.all([getCurrentTenant(), sessionUser()]);
  const meId = me?.id ?? "__none__";

  const common = {
    askedBy: { select: { name: true, email: true } },
    assignee: { select: { name: true, email: true } },
    ticket: { select: { id: true, subject: true, customer: { select: { displayName: true } } } },
    replies: { select: { id: true } },
  } as const;
  const [active, recentClosed] = await Promise.all([
    prisma.ticketQuestion.findMany({
      where: {
        tenantId: tenant.id,
        status: { in: ["open", "answered"] },
        OR: [{ assigneeId: meId }, { assigneeId: null }, { askedById: meId }],
      },
      include: common,
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    prisma.ticketQuestion.findMany({
      where: { tenantId: tenant.id, status: "closed", OR: [{ assigneeId: meId }, { askedById: meId }] },
      include: common,
      orderBy: { updatedAt: "desc" },
      take: 15,
    }),
  ]);

  const waiting = active.filter((q) => q.status === "open" && q.assigneeId === meId);
  const openTeam = active.filter((q) => q.assigneeId === null && q.status === "open" && q.askedById !== meId);
  const mine = active.filter((q) => q.askedById === meId);

  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="page-title">Team questions</h1>
        <span className="text-sm text-neutral-500">
          answer here — the customer team folds it into their reply
        </span>
      </div>

      <div className="mb-4 overflow-hidden rounded-xl border border-neutral-200 bg-white">
        <div className="border-b border-neutral-100 bg-cream px-4 py-2 text-xs font-semibold uppercase tracking-wide text-warm-grey">
          Waiting on you ({waiting.length})
        </div>
        <QuestionList rows={waiting} empty="Nothing waiting on you." />
      </div>

      {openTeam.length > 0 && (
        <div className="mb-4 overflow-hidden rounded-xl border border-neutral-200 bg-white">
          <div className="border-b border-neutral-100 bg-cream px-4 py-2 text-xs font-semibold uppercase tracking-wide text-warm-grey">
            Open for anyone ({openTeam.length})
          </div>
          <QuestionList rows={openTeam} empty="" />
        </div>
      )}

      {mine.length > 0 && (
        <div className="mb-4 overflow-hidden rounded-xl border border-neutral-200 bg-white">
          <div className="border-b border-neutral-100 bg-cream px-4 py-2 text-xs font-semibold uppercase tracking-wide text-warm-grey">
            You asked ({mine.length})
          </div>
          <QuestionList rows={mine} empty="" />
        </div>
      )}

      {recentClosed.length > 0 && (
        <details className="rounded-xl border border-neutral-200 bg-white">
          <summary className="cursor-pointer px-4 py-2 text-xs font-semibold uppercase tracking-wide text-warm-grey">
            Recently closed ({recentClosed.length})
          </summary>
          <QuestionList rows={recentClosed} empty="" />
        </details>
      )}
    </div>
  );
}
