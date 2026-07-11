import Link from "next/link";
import { unstable_cache } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { sessionUser, isAdminRole } from "@/lib/roles";
import { computeReplyState, REPLY_STATE_LABEL, type ReplyState } from "@/lib/reply-state";
import { NOISE_CATEGORIES } from "@/lib/triage";
import { categoryLabel } from "@/lib/categories";
import { msAgo, nowMs } from "@/lib/time";
import { MISSED_ARCHIVE_TAG } from "@/lib/external-archive";
import { isPriority, priorityWeight } from "@/lib/priority";
import InboxList, { type Row } from "./InboxList";
import InboxFilters from "./InboxFilters";
import ExpiredNotesReview from "./ExpiredNotesReview";
import MissedArchiveReview from "./MissedArchiveReview";

export const dynamic = "force-dynamic";

import type { Prisma } from "@prisma/client";

type ViewKey = "mine" | "open" | "noise" | "all";
const REPLY_FILTERS: ReplyState[] = ["first_contact", "follow_up", "waiting_customer"];

const SINCE_HOURS: Record<string, number> = { "24h": 24, "7d": 168, "30d": 720 };

export default async function Inbox({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    reply?: string;
    cat?: string;
    assignee?: string;
    priority?: string;
    since?: string;
    needs?: string;
    sort?: string;
    dir?: string;
    mbx?: string;
  }>;
}) {
  const [tenant, me] = await Promise.all([getCurrentTenant(), sessionUser()]);
  // Simple-view users land on the Q&A queue instead of the workspace inbox;
  // an explicit "full" cookie (the header toggle) overrides their default.
  // Cached 60s — cookie-less full-view users hit this on the app's hottest
  // page, and an uncached lookup would add a full DB round trip every load.
  const cookieView = (await cookies()).get("concierge-view")?.value;
  if (cookieView !== "full" && me?.id) {
    const getPreferredView = unstable_cache(
      async (userId: string) =>
        (await prisma.user.findUnique({ where: { id: userId }, select: { preferredView: true } }))?.preferredView ??
        "full",
      ["inbox-preferred-view"],
      { revalidate: 60 }
    );
    const pref = cookieView === "simple" ? "simple" : await getPreferredView(me.id);
    if (pref === "simple") redirect("/questions");
  }
  const admin = isAdminRole(me?.role);
  const sp = await searchParams;
  const { view: rawView, reply: rawReply } = sp;
  // Admins (triage) land on everything; specialists land on their own queue.
  const defaultView: ViewKey = admin ? "open" : "mine";
  const view: ViewKey = (["mine", "open", "noise", "all"] as const).includes(rawView as ViewKey)
    ? (rawView as ViewKey)
    : defaultView;
  const replyFilter = REPLY_FILTERS.includes(rawReply as ReplyState) ? (rawReply as ReplyState) : null;

  // Toolbar filters — every combination is a shareable saved-filter URL (the
  // digest tiles deep-link here). Any active filter/sort flattens the list.
  const sinceHours = SINCE_HOURS[sp.since ?? ""] ?? null;
  const priorityFilter = isPriority(sp.priority) ? sp.priority : null;
  const filterWhere: Prisma.TicketWhereInput = {
    ...(sp.cat ? { category: sp.cat } : {}),
    ...(sp.assignee === "none" ? { assigneeId: null } : sp.assignee ? { assigneeId: sp.assignee } : {}),
    ...(priorityFilter ? { priority: priorityFilter } : {}),
    // Single-mailbox view (hello@ vs marketing@ vs wholesale@) by address.
    ...(sp.mbx ? { channelRef: { supportAddress: sp.mbx } } : {}),
    ...(sinceHours ? { createdAt: { gte: msAgo(sinceHours * 3_600_000) } } : {}),
    // Time-window filters mean "real inquiries that arrived" — keep auto-
    // archived noise out unless the Noise view is explicitly selected.
    ...(sinceHours && view !== "noise" ? { NOT: { tags: { hasSome: [...NOISE_CATEGORIES] } } } : {}),
  };
  const needsFilter = sp.needs === "1" ? true : sp.needs === "0" ? false : null;
  const SORT_KEYS = ["newest", "oldest", "waiting", "received", "lastreply", "activity", "customer", "category", "status", "assignee", "priority"];
  const sort = SORT_KEYS.includes(sp.sort ?? "") ? sp.sort! : null;
  const dir = sp.dir === "asc" ? "asc" : "desc";
  const flat = Object.keys(filterWhere).length > 0 || needsFilter !== null || sort !== null;

  const VIEWS: Record<ViewKey, { label: string; where: Prisma.TicketWhereInput }> = {
    mine: {
      label: "My tickets",
      where: { status: { notIn: ["archived", "resolved"] }, assigneeId: me?.id ?? "__none__" },
    },
    open: { label: admin ? "All open" : "Everything open", where: { status: { notIn: ["archived", "resolved"] } } },
    noise: { label: "Noise", where: { status: "archived" } },
    all: { label: "All", where: {} },
  };

  const ticketInclude = {
    customer: { select: { displayName: true } },
    channelRef: { select: { supportAddress: true } },
    assignee: { select: { id: true, email: true, name: true } },
    // Reply-state needs direction + time only — full bodies for every
    // message of 100 tickets were the inbox's heaviest payload.
    messages: { orderBy: { sentAt: "asc" as const }, select: { direction: true, sentAt: true } },
  };
  const [urgentTickets, restTickets, counts, users, assignedCounts, mineCount, mailboxes] = await Promise.all([
    // Urgent first and UNCAPPED by the main window — an old urgent ticket
    // must never fall off the list. A non-urgent priority filter skips this
    // query; the trailing priority clause would otherwise override the filter.
    priorityFilter && priorityFilter !== "urgent"
      ? Promise.resolve([])
      : prisma.ticket.findMany({
          where: { tenantId: tenant.id, ...VIEWS[view].where, ...filterWhere, priority: "urgent" },
          include: ticketInclude,
          orderBy: { createdAt: "desc" },
          take: 50,
        }),
    // And the urgent-only filter skips the rest-of-the-list query.
    priorityFilter === "urgent"
      ? Promise.resolve([])
      : prisma.ticket.findMany({
          where: {
            tenantId: tenant.id,
            ...VIEWS[view].where,
            ...filterWhere,
            ...(priorityFilter ? {} : { priority: { not: "urgent" } }),
          },
          include: ticketInclude,
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
    // Same where-clause as the My-tickets view, so the tab count matches its list.
    me?.id
      ? prisma.ticket.count({ where: { tenantId: tenant.id, ...VIEWS.mine.where } })
      : Promise.resolve(0),
    // The tenant's mailboxes power the single-mailbox filter (shown when >1).
    prisma.channel.findMany({
      where: { tenantId: tenant.id },
      select: { supportAddress: true },
      orderBy: { supportAddress: "asc" },
    }),
  ]);
  const tickets = [...urgentTickets, ...restTickets];
  // Snippets: the first inbound message per ticket (DISTINCT ON), truncated
  // in SQL-adjacent JS — one slim row per ticket instead of whole threads.
  const [firstInbounds, expiredNotes, missedTickets] = await Promise.all([
    prisma.message.findMany({
      where: { ticketId: { in: tickets.map((t) => t.id) }, direction: "inbound" },
      orderBy: [{ ticketId: "asc" }, { sentAt: "asc" }],
      distinct: ["ticketId"],
      select: { ticketId: true, text: true },
    }),
    // Expired context notes queue for the triage admin — the "did the PO
    // arrive?" prompt. Expired notes already stopped feeding drafts.
    admin
      ? prisma.contextNote.findMany({
          where: { tenantId: tenant.id, expiresAt: { lt: new Date() } },
          orderBy: { expiresAt: "asc" },
          take: 20,
        })
      : Promise.resolve([]),
    // "Did you miss this?" — threads archived in Gmail while their ticket
    // still looked like live work. Shown to everyone: a missed customer
    // email is whoever-sees-it-first's problem.
    prisma.ticket.findMany({
      where: { tenantId: tenant.id, tags: { has: MISSED_ARCHIVE_TAG } },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: {
        id: true,
        subject: true,
        priority: true,
        customer: { select: { displayName: true } },
        messages: { where: { direction: "inbound" }, orderBy: { sentAt: "desc" }, take: 1, select: { sentAt: true } },
      },
    }),
  ]);
  const snippetOf = new Map(firstInbounds.map((m) => [m.ticketId, m.text.slice(0, 110)]));

  const noiseCount = counts.find((c) => c.status === "archived")?._count ?? 0;
  const openCount = counts.filter((c) => !["archived", "resolved"].includes(c.status)).reduce((s, c) => s + c._count, 0);
  const unassignedCount = assignedCounts.find((c) => c.assigneeId === null)?._count ?? 0;

  const noiseCats = new Set<string>(NOISE_CATEGORIES);
  const now = nowMs();
  let rows: Row[] = tickets.map((t) => {
    const lastInbound = [...t.messages].reverse().find((m) => m.direction === "inbound");
    const replyState = computeReplyState(t.messages);
    const coarseTag = t.tags.find((tag) => !tag.startsWith("product:")) ?? null;
    const open = !["archived", "resolved", "replied"].includes(t.status);
    const needsReply = replyState === "first_contact" || replyState === "follow_up";
    const lastOutbound = [...t.messages].reverse().find((m) => m.direction === "outbound");
    const lastMsg = t.messages[t.messages.length - 1];
    return {
      id: t.id,
      name: t.customer.displayName ?? "Customer",
      subject: t.subject ?? "",
      snippet: snippetOf.get(t.id) ?? "",
      status: t.status,
      lastReplyAt: lastOutbound ? lastOutbound.sentAt.getTime() : null,
      lastActivityAt: lastMsg ? lastMsg.sentAt.getTime() : t.createdAt.getTime(),
      maybeHandled: t.tags.includes("maybe_handled"),
      category: t.category ? categoryLabel(t.category) : (coarseTag?.replace(/_/g, " ") ?? null),
      categoryKey: t.category ?? coarseTag,
      // every ticket shows its mailbox in the feed (hello, marketing,
      // wholesale, ...) so multi-inbox brands can tell them apart at a glance
      mailboxTag: t.channelRef?.supportAddress?.split("@")[0] ?? null,
      urgent: t.priority === "urgent" && open,
      priority: t.priority,
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
  if (needsFilter !== null) rows = rows.filter((r) => r.needsReply === needsFilter);
  // Importance order: urgent → needs a reply → been waiting longest. The
  // triage admin works this list top to bottom. An explicit sort overrides.
  const flip = dir === "asc" ? -1 : 1;
  const cmpStr = (a: string | null, b: string | null) => (a ?? "\uffff").localeCompare(b ?? "\uffff");
  if (sort === "newest") rows.sort((a, b) => b.createdAt - a.createdAt);
  else if (sort === "oldest") rows.sort((a, b) => a.createdAt - b.createdAt);
  else if (sort === "received") rows.sort((a, b) => flip * (b.createdAt - a.createdAt));
  else if (sort === "lastreply") rows.sort((a, b) => flip * ((b.lastReplyAt ?? -1) - (a.lastReplyAt ?? -1)));
  else if (sort === "activity") rows.sort((a, b) => flip * (b.lastActivityAt - a.lastActivityAt));
  else if (sort === "customer") rows.sort((a, b) => -flip * cmpStr(a.name, b.name));
  else if (sort === "category") rows.sort((a, b) => -flip * cmpStr(a.category, b.category));
  else if (sort === "status") rows.sort((a, b) => -flip * cmpStr(a.status, b.status));
  else if (sort === "assignee") rows.sort((a, b) => -flip * cmpStr(a.assigneeLabel, b.assigneeLabel));
  else if (sort === "priority") rows.sort((a, b) => flip * (priorityWeight(b.priority) - priorityWeight(a.priority)) || a.createdAt - b.createdAt);
  else if (sort === "waiting") rows.sort((a, b) => flip * ((b.waitingDays ?? -1) - (a.waitingDays ?? -1)) || a.createdAt - b.createdAt);
  else
    rows.sort(
      (a, b) =>
        Number(b.urgent) - Number(a.urgent) ||
        Number(b.needsReply) - Number(a.needsReply) ||
        priorityWeight(b.priority) - priorityWeight(a.priority) ||
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
          {/* Tabs change WHAT you look at; the pill chips below only filter it. */}
          <nav className="flex gap-4 text-sm">
            {visibleViews.map((k) => (
              <Link key={k} href={viewHref(k)} className={`tab ${view === k ? "tab-active" : ""}`}>
                {VIEWS[k].label}
                <span className="ml-1 text-xs text-neutral-400 tabular-nums">{countOf(k)}</span>
              </Link>
            ))}
          </nav>
        </div>
        <span className="hidden text-sm text-neutral-500 tabular-nums sm:inline">{rows.length} shown</span>
      </div>

      {/* threads archived in Gmail that still looked like live work */}
      <MissedArchiveReview
        tickets={missedTickets.map((t) => {
          const lastInbound = t.messages[0]?.sentAt ?? null;
          return {
            id: t.id,
            subject: t.subject ?? "",
            name: t.customer.displayName ?? "Customer",
            urgent: t.priority === "urgent",
            lastInboundAt: lastInbound ? lastInbound.toISOString() : null,
            waitingDays: lastInbound ? Math.floor((now - lastInbound.getTime()) / 86_400_000) : null,
          };
        })}
      />

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
            .map((u) => ({
              u,
              n: assignedCounts.find((c) => c.assigneeId === u.id)?._count ?? 0,
              pressing: rows.filter((r) => r.assigneeId === u.id && r.needsReply).length,
            }))
            .filter(({ n }) => n > 0)
            .sort((a, b) => b.pressing - a.pressing || b.n - a.n)
            .map(({ u, n, pressing }) => (
              <span
                key={u.id}
                className={`rounded-full px-2.5 py-1 ${pressing > 0 ? "bg-amber-50 text-amber-800" : "bg-neutral-100 text-neutral-600"}`}
                title={`${n} open assigned · ${pressing} awaiting a reply`}
              >
                {u.name ?? u.email.split("@")[0]} · {pressing > 0 ? `${pressing} to answer / ` : ""}{n} open
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

      <InboxFilters
        users={users.map((u) => ({ id: u.id, label: u.name ?? u.email.split("@")[0] }))}
        mailboxes={mailboxes.map((c) => c.supportAddress)}
      />

      <InboxList
        rows={rows}
        view={view}
        flat={flat}
        sort={sort}
        dir={dir}
        canAssign={admin}
        users={users.map((u) => ({ id: u.id, label: u.name ?? u.email.split("@")[0] }))}
      />
    </div>
  );
}
