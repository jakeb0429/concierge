import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { sessionUser, isAdminRole } from "@/lib/roles";
import { computeReplyState, REPLY_STATE_LABEL, type ReplyState } from "@/lib/reply-state";
import { NOISE_CATEGORIES } from "@/lib/triage";
import { categoryLabel } from "@/lib/categories";
import InboxList, { type Row } from "./InboxList";
import ExpiredNotesReview from "./ExpiredNotesReview";

export const dynamic = "force-dynamic";

import type { Prisma } from "@prisma/client";

type ViewKey = "mine" | "open" | "noise" | "all";
const REPLY_FILTERS: ReplyState[] = ["first_contact", "follow_up", "waiting_customer"];

export default async function Inbox({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; reply?: string }>;
}) {
  const [tenant, me] = await Promise.all([getCurrentTenant(), sessionUser()]);
  const admin = isAdminRole(me?.role);
  const { view: rawView, reply: rawReply } = await searchParams;
  // Admins (triage) land on everything; specialists land on their own queue.
  const defaultView: ViewKey = admin ? "open" : "mine";
  const view: ViewKey = (["mine", "open", "noise", "all"] as const).includes(rawView as ViewKey)
    ? (rawView as ViewKey)
    : defaultView;
  const replyFilter = REPLY_FILTERS.includes(rawReply as ReplyState) ? (rawReply as ReplyState) : null;

  const VIEWS: Record<ViewKey, { label: string; where: Prisma.TicketWhereInput }> = {
    mine: {
      label: "My tickets",
      where: { status: { notIn: ["archived", "resolved"] }, assigneeId: me?.id ?? "__none__" },
    },
    open: { label: admin ? "All open" : "Everything open", where: { status: { notIn: ["archived", "resolved"] } } },
    noise: { label: "Noise", where: { status: "archived" } },
    all: { label: "All", where: {} },
  };

  const [tickets, counts, users, assignedCounts] = await Promise.all([
    prisma.ticket.findMany({
      where: { tenantId: tenant.id, ...VIEWS[view].where },
      include: {
        customer: true,
        channelRef: true,
        assignee: { select: { id: true, email: true, name: true } },
        messages: { orderBy: { sentAt: "asc" }, select: { direction: true, sentAt: true, text: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.ticket.groupBy({ by: ["status"], where: { tenantId: tenant.id }, _count: true }),
    prisma.user.findMany({
      where: { tenantId: tenant.id },
      select: { id: true, email: true, name: true },
      orderBy: { email: "asc" },
    }),
    prisma.ticket.groupBy({
      by: ["assigneeId"],
      where: { tenantId: tenant.id, status: { notIn: ["archived", "resolved", "replied"] } },
      _count: true,
    }),
  ]);
  // Expired context notes queue for the triage admin — the "did the PO
  // arrive?" prompt. Expired notes already stopped feeding drafts.
  const expiredNotes = admin
    ? await prisma.contextNote.findMany({
        where: { tenantId: tenant.id, expiresAt: { lt: new Date() } },
        orderBy: { expiresAt: "asc" },
        take: 20,
      })
    : [];

  const noiseCount = counts.find((c) => c.status === "archived")?._count ?? 0;
  const openCount = counts.filter((c) => !["archived", "resolved"].includes(c.status)).reduce((s, c) => s + c._count, 0);
  const mineCount = assignedCounts.find((c) => c.assigneeId === me?.id)?._count ?? 0;
  const unassignedCount = assignedCounts.find((c) => c.assigneeId === null)?._count ?? 0;

  const noiseCats = new Set<string>(NOISE_CATEGORIES);
  const now = Date.now();
  let rows: Row[] = tickets.map((t) => {
    const firstInbound = t.messages.find((m) => m.direction === "inbound");
    const lastInbound = [...t.messages].reverse().find((m) => m.direction === "inbound");
    const replyState = computeReplyState(t.messages);
    const coarseTag = t.tags.find((tag) => !tag.startsWith("product:")) ?? null;
    const open = !["archived", "resolved", "replied"].includes(t.status);
    const needsReply = replyState === "first_contact" || replyState === "follow_up";
    return {
      id: t.id,
      name: t.customer.displayName ?? "Customer",
      subject: t.subject ?? "",
      snippet: firstInbound?.text.slice(0, 110) ?? "",
      status: t.status,
      category: t.category ? categoryLabel(t.category) : (coarseTag?.replace(/_/g, " ") ?? null),
      wholesale: t.channelRef?.supportAddress?.startsWith("wholesale") ?? false,
      urgent: t.priority === "high" && open,
      replyState,
      looksNoise: coarseTag !== null && noiseCats.has(coarseTag),
      assigneeId: t.assignee?.id ?? null,
      assigneeLabel: t.assignee ? (t.assignee.name ?? t.assignee.email.split("@")[0]) : null,
      waitingDays: needsReply && lastInbound ? Math.floor((now - lastInbound.sentAt.getTime()) / 86_400_000) : null,
      needsReply,
      createdAt: t.createdAt.getTime(),
    };
  });
  if (replyFilter) rows = rows.filter((r) => r.replyState === replyFilter);
  // Importance order: urgent → needs a reply → been waiting longest. The
  // triage admin works this list top to bottom.
  rows.sort(
    (a, b) =>
      Number(b.urgent) - Number(a.urgent) ||
      Number(b.needsReply) - Number(a.needsReply) ||
      (a.needsReply ? a.createdAt - b.createdAt : b.createdAt - a.createdAt)
  );

  const visibleViews: ViewKey[] = admin ? ["open", "mine", "noise", "all"] : ["mine", "open", "noise", "all"];
  const viewHref = (k: ViewKey) => (k === defaultView ? "/" : `/?view=${k}`);
  const countOf = (k: ViewKey) => (k === "open" ? ` ${openCount}` : k === "noise" ? ` ${noiseCount}` : k === "mine" ? ` ${mineCount}` : "");

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <div className="flex items-baseline gap-4">
          <h1 className="page-title">Inbox</h1>
          <nav className="flex gap-2 text-sm">
            {visibleViews.map((k) => (
              <Link
                key={k}
                href={viewHref(k)}
                className={`rounded-full px-3 py-1 ${
                  view === k ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-neutral-100"
                }`}
              >
                {VIEWS[k].label}
                {countOf(k)}
              </Link>
            ))}
          </nav>
        </div>
        <span className="text-sm text-neutral-500">{rows.length} shown</span>
      </div>

      {/* triage admin: expired context notes need a decision */}
      {admin && (
        <ExpiredNotesReview
          notes={expiredNotes.map((n) => ({
            id: n.id,
            body: n.body,
            expiresAt: n.expiresAt!.toISOString(),
            href: n.ticketId ? `/tickets/${n.ticketId}` : `/customers/${n.customerId}`,
            scopeLabel: n.ticketId ? "view ticket" : "view customer",
          }))}
        />
      )}

      {/* triage admin: who's carrying what */}
      {admin && view === "open" && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium uppercase tracking-wide text-neutral-400">Workload</span>
          {unassignedCount > 0 && (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-700">
              {unassignedCount} unassigned
            </span>
          )}
          {users
            .map((u) => ({ u, n: assignedCounts.find((c) => c.assigneeId === u.id)?._count ?? 0 }))
            .filter(({ n }) => n > 0)
            .sort((a, b) => b.n - a.n)
            .map(({ u, n }) => (
              <span key={u.id} className="rounded-full bg-neutral-100 px-2.5 py-1 text-neutral-600">
                {u.name ?? u.email.split("@")[0]} · {n}
              </span>
            ))}
        </div>
      )}

      {/* reply-state filter — automatic rules, always current */}
      <div className="mb-3 flex items-center gap-2 text-xs">
        <Link
          href={viewHref(view)}
          className={`rounded-full px-2.5 py-1 ${!replyFilter ? "bg-neutral-200 text-neutral-800" : "text-neutral-500 hover:bg-neutral-100"}`}
        >
          all
        </Link>
        {REPLY_FILTERS.map((f) => (
          <Link
            key={f}
            href={`/?${view === defaultView ? "" : `view=${view}&`}reply=${f}`}
            className={`rounded-full px-2.5 py-1 ${replyFilter === f ? "bg-neutral-200 text-neutral-800" : "text-neutral-500 hover:bg-neutral-100"}`}
          >
            {REPLY_STATE_LABEL[f]}
          </Link>
        ))}
      </div>

      <InboxList
        rows={rows}
        view={view}
        canAssign={admin}
        users={users.map((u) => ({ id: u.id, label: u.name ?? u.email.split("@")[0] }))}
      />
    </div>
  );
}
