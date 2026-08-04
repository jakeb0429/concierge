import { prisma } from "./db";
import { computeResponseTimes, computeReplyTrend, type ResponseTimes, type TrendPoint } from "./response-times";
import { cleanEmailText } from "./email-clean";
import { categoryLabel } from "./categories";
import { INACTIVE_STATUSES } from "./ticket-status";

/**
 * The operational digest — one data object rendered two ways (the /digest
 * page and the emailed report). daily = last 24h, weekly = last 7 days.
 */

export type DigestPeriod = "daily" | "weekly";

export type UrgentTile = {
  id: string;
  subject: string | null;
  customer: string;
  category: string | null;
  waitingMs: number;
  preview: string;
};

/** Short human preview of a customer message: quoted history cut, security
 *  banners stripped, whitespace collapsed, capped for a tile. */
export function ticketPreview(raw: string | null | undefined, max = 170): string {
  if (!raw) return "";
  let t = "";
  try {
    t = cleanEmailText(raw);
  } catch {
    t = raw;
  }
  t = t
    .replace(/caution:\s*this message was sent from outside[^.]*\.\s*please do not click[^.]*\.\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

export type DigestData = {
  tenantName: string;
  period: DigestPeriod;
  periodLabel: string;
  // activity in the period
  newTickets: number;
  newByCategory: { category: string; label: string; n: number }[];
  noiseFiltered: number;
  repliesSent: number;
  brainChanges: number;
  // current state (as of now)
  needsReply: number;
  urgentOpen: number;
  unassigned: number;
  trainingOpen: number;
  expiredNotes: number;
  workload: { label: string; n: number }[];
  responseTimes: ResponseTimes;
  /** open urgent tickets, oldest first — rendered as clickable tiles */
  urgentTickets: UrgentTile[];
  /** trailing per-day median first reply (14d daily / 30d weekly) */
  replyTrend: TrendPoint[];
};

export async function buildDigest(tenantId: string, period: DigestPeriod): Promise<DigestData> {
  const hours = period === "daily" ? 24 : 24 * 7;
  const since = new Date(Date.now() - hours * 3_600_000);
  const NOISE = ["automated_notification", "vendor_outreach", "internal", "spam"];

  const [
    tenant,
    createdTickets,
    replyEvents,
    brainEvents,
    openTickets,
    unassigned,
    trainingOpen,
    expiredNotes,
    workloadRaw,
    users,
    responseTimes,
    urgentRows,
    replyTrend,
  ] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } }),
    prisma.ticket.findMany({
      where: { tenantId, createdAt: { gte: since } },
      select: { category: true, tags: true },
    }),
    prisma.auditEvent.count({
      where: { tenantId, action: { in: ["reply_sent", "ticket_replied_external"] }, createdAt: { gte: since } },
    }),
    prisma.auditEvent.count({
      where: { tenantId, action: { in: ["signal_approved", "answer_promoted"] }, createdAt: { gte: since } },
    }),
    prisma.ticket.findMany({
      where: { tenantId, status: { notIn: INACTIVE_STATUSES } },
      select: { priority: true, messages: { orderBy: { sentAt: "desc" }, take: 1, select: { direction: true } } },
    }),
    prisma.ticket.count({
      where: { tenantId, status: { notIn: INACTIVE_STATUSES }, assigneeId: null },
    }),
    prisma.learningSignal.count({ where: { tenantId, status: "open" } }),
    prisma.contextNote.count({ where: { tenantId, expiresAt: { lt: new Date() } } }),
    prisma.ticket.groupBy({
      by: ["assigneeId"],
      where: { tenantId, assigneeId: { not: null }, status: { notIn: INACTIVE_STATUSES } },
      _count: true,
    }),
    prisma.user.findMany({ where: { tenantId }, select: { id: true, name: true, email: true } }),
    computeResponseTimes(tenantId, period === "daily" ? 7 : 30), // KPI window wider than the digest window
    prisma.ticket.findMany({
      where: { tenantId, status: { notIn: INACTIVE_STATUSES }, priority: "urgent" },
      select: {
        id: true,
        subject: true,
        category: true,
        createdAt: true,
        customer: { select: { displayName: true, email: true } },
        messages: {
          where: { direction: "inbound" },
          orderBy: { sentAt: "desc" },
          take: 1,
          select: { text: true, sentAt: true },
        },
      },
      orderBy: { createdAt: "asc" },
      take: 12,
    }),
    computeReplyTrend(tenantId, period === "daily" ? 14 : 30),
  ]);

  const real = createdTickets.filter((t) => !t.tags.some((tag) => NOISE.includes(tag)));
  const byCat = new Map<string, number>();
  for (const t of real) byCat.set(t.category ?? "other", (byCat.get(t.category ?? "other") ?? 0) + 1);
  const userLabel = new Map(users.map((u) => [u.id, u.name ?? u.email.split("@")[0]]));

  return {
    tenantName: tenant.name,
    period,
    periodLabel: period === "daily" ? "last 24 hours" : "last 7 days",
    newTickets: real.length,
    newByCategory: [...byCat.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([category, n]) => ({ category, label: categoryLabel(category), n })),
    noiseFiltered: createdTickets.length - real.length,
    repliesSent: replyEvents,
    brainChanges: brainEvents,
    needsReply: openTickets.filter((t) => t.messages[0]?.direction === "inbound").length,
    urgentOpen: openTickets.filter((t) => t.priority === "urgent").length,
    unassigned,
    trainingOpen,
    expiredNotes,
    workload: workloadRaw
      .map((w) => ({ label: userLabel.get(w.assigneeId!) ?? "?", n: w._count }))
      .sort((a, b) => b.n - a.n),
    responseTimes,
    urgentTickets: urgentRows.map((t) => {
      const last = t.messages[0];
      return {
        id: t.id,
        subject: t.subject,
        customer: t.customer.displayName ?? t.customer.email ?? "customer",
        category: t.category,
        waitingMs: Date.now() - (last?.sentAt ?? t.createdAt).getTime(),
        preview: ticketPreview(last?.text),
      };
    }),
    replyTrend,
  };
}

// ---------------------------------------------------------------------------
// Tile drill-downs — every digest number is clickable; these return the rows
// behind it. Capped at 100, newest first.

export type DigestRecord = { label: string; sublabel: string; href: string | null; when: Date | null };

export const DRILL_KEYS = [
  "new",
  "replies",
  "noise",
  "brain",
  "needsreply",
  "urgent",
  "unassigned",
  "training",
  "expired",
] as const;
export type DrillKey = (typeof DRILL_KEYS)[number];

export const DRILL_TITLE: Record<DrillKey, string> = {
  new: "New inquiries",
  replies: "Replies sent",
  noise: "Noise filtered automatically",
  brain: "Brain changes approved",
  needsreply: "Tickets needing a reply",
  urgent: "Urgent open tickets",
  unassigned: "Unassigned open tickets",
  training: "Training questions pending",
  expired: "Expired context notes",
};

const NOISE = ["automated_notification", "vendor_outreach", "internal", "spam"];

export async function digestRecords(tenantId: string, period: DigestPeriod, key: DrillKey): Promise<DigestRecord[]> {
  const hours = period === "daily" ? 24 : 24 * 7;
  const since = new Date(Date.now() - hours * 3_600_000);
  const openWhere = { tenantId, status: { notIn: INACTIVE_STATUSES } };

  const ticketRecord = (
    t: { id: string; subject: string | null; category: string | null; createdAt: Date; customer: { displayName: string | null; email: string | null } },
    sub?: string
  ): DigestRecord => ({
    label: t.subject ?? "(no subject)",
    sublabel: sub ?? `${t.customer.displayName ?? t.customer.email ?? "customer"}${t.category ? " · " + categoryLabel(t.category) : ""}`,
    href: `/tickets/${t.id}`,
    when: t.createdAt,
  });
  const ticketSelect = {
    id: true,
    subject: true,
    category: true,
    createdAt: true,
    tags: true,
    priority: true,
    customer: { select: { displayName: true, email: true } },
  } as const;

  switch (key) {
    case "new":
    case "noise": {
      const rows = await prisma.ticket.findMany({
        where: { tenantId, createdAt: { gte: since } },
        select: ticketSelect,
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      const wantNoise = key === "noise";
      return rows
        .filter((t) => t.tags.some((tag) => NOISE.includes(tag)) === wantNoise)
        .slice(0, 100)
        .map((t) => ticketRecord(t));
    }
    case "replies": {
      const events = await prisma.auditEvent.findMany({
        where: { tenantId, action: { in: ["reply_sent", "ticket_replied_external"] }, createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      const ids = [...new Set(events.map((e) => e.entity.replace("ticket:", "")))];
      const tickets = await prisma.ticket.findMany({ where: { id: { in: ids } }, select: ticketSelect });
      const byId = new Map(tickets.map((t) => [t.id, t]));
      return events.map((e) => {
        const t = byId.get(e.entity.replace("ticket:", ""));
        return {
          label: t?.subject ?? "(ticket removed)",
          sublabel: e.action === "ticket_replied_external" ? "answered in Gmail" : "sent from Concierge",
          href: t ? `/tickets/${t.id}` : null,
          when: e.createdAt,
        };
      });
    }
    case "brain": {
      const events = await prisma.auditEvent.findMany({
        where: { tenantId, action: { in: ["signal_approved", "answer_promoted"] }, createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      return events.map((e) => ({
        label: e.action === "signal_approved" ? "Training approved → Brain updated" : "Answer promoted to the Brain",
        sublabel: e.entity,
        href: "/brain",
        when: e.createdAt,
      }));
    }
    case "needsreply":
    case "urgent":
    case "unassigned": {
      const rows = await prisma.ticket.findMany({
        where: {
          ...openWhere,
          ...(key === "urgent" ? { priority: "urgent" } : {}),
          ...(key === "unassigned" ? { assigneeId: null } : {}),
        },
        select: { ...ticketSelect, messages: { orderBy: { sentAt: "desc" as const }, take: 1, select: { direction: true } } },
        orderBy: { createdAt: "asc" },
        take: 150,
      });
      const filtered = key === "needsreply" ? rows.filter((t) => t.messages[0]?.direction === "inbound") : rows;
      return filtered.slice(0, 100).map((t) => ticketRecord(t));
    }
    case "training": {
      const signals = await prisma.learningSignal.findMany({
        where: { tenantId, status: "open" },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      const users = await prisma.user.findMany({ where: { tenantId }, select: { id: true, name: true, email: true } });
      const label = new Map(users.map((u) => [u.id, u.name ?? u.email.split("@")[0]]));
      return signals.map((s) => ({
        label: (s.proposedText ?? s.kind).slice(0, 110),
        sublabel: `${s.kind.replace(/_/g, " ")}${s.category ? " · " + categoryLabel(s.category) : ""} · ${s.assigneeId ? `assigned to ${label.get(s.assigneeId) ?? "?"}` : "admin queue"}`,
        href: "/brain",
        when: s.createdAt,
      }));
    }
    case "expired": {
      const notes = await prisma.contextNote.findMany({
        where: { tenantId, expiresAt: { lt: new Date() } },
        orderBy: { expiresAt: "asc" },
        take: 100,
      });
      return notes.map((n) => ({
        label: n.body.slice(0, 110),
        sublabel: n.ticketId ? "ticket note" : "customer note",
        href: n.ticketId ? `/tickets/${n.ticketId}` : `/customers/${n.customerId}`,
        when: n.expiresAt,
      }));
    }
  }
}
