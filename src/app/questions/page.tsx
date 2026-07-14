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
 *  a shareable URL. Each chip carries that person's OPEN-question count so the
 *  load is visible at a glance; teammates sort busiest-first. */
function ScopeBar({
  who,
  users,
  allCount,
  unassignedCount,
}: {
  who: string;
  users: { id: string; label: string; count: number }[];
  allCount: number;
  unassignedCount: number;
}) {
  const chip = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${active ? "bg-gold text-white" : "border border-neutral-200 text-neutral-600 hover:bg-neutral-50"}`;
  const countBadge = (n: number, active: boolean) =>
    n > 0 ? (
      <span
        className={`rounded-full px-1.5 text-[10px] font-semibold leading-4 ${active ? "bg-white/25 text-white" : "bg-neutral-100 text-neutral-700"}`}
      >
        {n}
      </span>
    ) : null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-warm-grey">View</span>
      <Link href="/questions" className={chip(who === "me")}>
        Mine
      </Link>
      <Link href="/questions?who=all" className={chip(who === "all")}>
        Everyone {countBadge(allCount, who === "all")}
      </Link>
      {unassignedCount > 0 && (
        <Link href="/questions?who=unassigned" className={chip(who === "unassigned")}>
          Unassigned {countBadge(unassignedCount, who === "unassigned")}
        </Link>
      )}
      {users.map((u) => (
        <Link key={u.id} href={`/questions?who=${u.id}`} className={chip(who === u.id)}>
          {u.label} {countBadge(u.count, who === u.id)}
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
  // Open-question counts ride on the scope chips (one cheap groupBy) so the
  // team's load is scannable; teammates sort busiest-first.
  let users: { id: string; label: string; count: number }[] = [];
  let allCount = 0;
  let unassignedCount = 0;
  if (admin) {
    const [tenantUsers, openByAssignee] = await Promise.all([
      cachedTenantUsers(tenant.id),
      prisma.ticketQuestion.groupBy({
        by: ["assigneeId"],
        where: { tenantId: tenant.id, status: "open" },
        _count: { _all: true },
      }),
    ]);
    const countFor = new Map(openByAssignee.map((g) => [g.assigneeId, g._count._all]));
    unassignedCount = countFor.get(null) ?? 0;
    allCount = openByAssignee.reduce((sum, g) => sum + g._count._all, 0);
    users = tenantUsers
      .map((u) => ({
        id: u.id,
        label: u.name ?? u.email.split("@")[0],
        count: countFor.get(u.id) ?? 0,
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
  }
  const rawWho = (await searchParams).who ?? "me";
  const who =
    admin && (rawWho === "all" || rawWho === "unassigned" || users.some((u) => u.id === rawWho))
      ? rawWho
      : "me";

  const header = (
    <div className="mb-4 flex items-baseline justify-between">
      <h1 className="page-title">Team questions</h1>
      <span className="text-sm text-neutral-500">answer here — the customer team folds it into their reply</span>
    </div>
  );

  // ADMIN SCOPE — the whole team's queue, one teammate's, or the unassigned
  // pool ("anyone" questions have no per-person view otherwise).
  if (who !== "me") {
    const assigneeWhere =
      who === "all" ? {} : who === "unassigned" ? { assigneeId: null } : { assigneeId: who };
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
    const whoLabel =
      who === "all"
        ? "the whole team"
        : who === "unassigned"
          ? "the unassigned pool (open to anyone)"
          : (users.find((u) => u.id === who)?.label ?? "this teammate");

    return (
      <div>
        {header}
        <ScopeBar who={who} users={users} allCount={allCount} unassignedCount={unassignedCount} />
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
      {admin && <ScopeBar who="me" users={users} allCount={allCount} unassignedCount={unassignedCount} />}
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
