import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { sessionUser, isAdminRole } from "@/lib/roles";
import { cachedTenantUsers } from "@/lib/team-cache";

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

function Box({ title, rows, empty }: { title: string; rows: QRow[]; empty?: string }) {
  if (rows.length === 0 && !empty) return null;
  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="border-b border-neutral-100 bg-cream px-4 py-2 text-xs font-semibold uppercase tracking-wide text-warm-grey">
        {title} ({rows.length})
      </div>
      <QuestionList rows={rows} empty={empty ?? ""} />
    </div>
  );
}

/** Admin-only scope switcher: view your own queue, the whole team's, or step
 *  through one teammate's. Server-rendered links — no client JS, every view is
 *  a shareable URL. */
function ScopeBar({ who, users }: { who: string; users: { id: string; label: string }[] }) {
  const chip = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs ${active ? "bg-gold text-white" : "border border-neutral-200 text-neutral-600 hover:bg-neutral-50"}`;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-warm-grey">View</span>
      <Link href="/questions" className={chip(who === "me")}>
        Mine
      </Link>
      <Link href="/questions?who=all" className={chip(who === "all")}>
        Everyone
      </Link>
      {users.map((u) => (
        <Link key={u.id} href={`/questions?who=${u.id}`} className={chip(who === u.id)}>
          {u.label}
        </Link>
      ))}
    </div>
  );
}

/**
 * The Simple View's home: every internal question waiting on you, plus the
 * ones you asked. Answer from here without ever touching the full workspace.
 * Admins get a scope switcher to view the whole team's queue or step through
 * any one teammate's — everyone else is always scoped to themselves.
 */
export default async function Questions({ searchParams }: { searchParams: Promise<{ who?: string }> }) {
  const [tenant, me] = await Promise.all([getCurrentTenant(), sessionUser()]);
  const meId = me?.id ?? "__none__";
  const admin = isAdminRole(me?.role);

  const common = {
    askedBy: { select: { name: true, email: true } },
    assignee: { select: { name: true, email: true } },
    ticket: { select: { id: true, subject: true, customer: { select: { displayName: true } } } },
    replies: { select: { id: true } },
  } as const;

  // Admin-only scope. Non-admins are pinned to "me" no matter what the URL says.
  const users = admin
    ? (await cachedTenantUsers(tenant.id)).map((u) => ({ id: u.id, label: u.name ?? u.email.split("@")[0] }))
    : [];
  const rawWho = (await searchParams).who ?? "me";
  const who = admin && (rawWho === "all" || users.some((u) => u.id === rawWho)) ? rawWho : "me";

  const header = (
    <div className="mb-4 flex items-baseline justify-between">
      <h1 className="page-title">Team questions</h1>
      <span className="text-sm text-neutral-500">answer here — the customer team folds it into their reply</span>
    </div>
  );

  // ADMIN SCOPE — the whole team's queue, or one teammate's, grouped by status.
  if (who !== "me") {
    const assigneeWhere = who === "all" ? {} : { assigneeId: who };
    const [active, recentClosed] = await Promise.all([
      prisma.ticketQuestion.findMany({
        where: { tenantId: tenant.id, status: { in: ["open", "answered"] }, ...assigneeWhere },
        include: common,
        orderBy: { updatedAt: "desc" },
        take: 200,
      }),
      prisma.ticketQuestion.findMany({
        where: { tenantId: tenant.id, status: "closed", ...assigneeWhere },
        include: common,
        orderBy: { updatedAt: "desc" },
        take: 20,
      }),
    ]);
    const open = active.filter((q) => q.status === "open");
    const answered = active.filter((q) => q.status === "answered");
    const whoLabel = who === "all" ? "the whole team" : (users.find((u) => u.id === who)?.label ?? "this teammate");

    return (
      <div>
        {header}
        <ScopeBar who={who} users={users} />
        <p className="mb-3 -mt-1 text-xs text-neutral-400">Showing questions for {whoLabel}.</p>
        <Box title="Open" rows={open} empty="No open questions here." />
        <Box title="Answered — awaiting close" rows={answered} />
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

  // DEFAULT — your own queue (the Simple View home).
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
      {header}
      {admin && <ScopeBar who="me" users={users} />}
      <Box title="Waiting on you" rows={waiting} empty="Nothing waiting on you." />
      <Box title="Open for anyone" rows={openTeam} />
      <Box title="You asked" rows={mine} />
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
