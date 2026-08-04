import { prisma } from "./db";
import { INACTIVE_STATUSES } from "./ticket-status";

/**
 * Response-time KPIs, computed from message history (Concierge-era tickets):
 *   first reply  — first OUTBOUND message after the first inbound
 *   resolution   — first resolved/archived transition after creation (audit)
 * Noise (auto-archived vendor pitches etc.) is excluded; only real inquiries
 * count against the team.
 */

export type ResponseStats = {
  n: number;
  medianMs: number | null;
  p90Ms: number | null;
};

export type ResponseTimes = {
  sinceDays: number;
  overall: ResponseStats & { resolvedN: number; medianResolutionMs: number | null };
  byAssignee: { label: string; stats: ResponseStats }[];
  byCategory: { category: string; stats: ResponseStats }[];
  /** Open tickets that still need a first reply, oldest first (the debt). */
  awaitingFirstReply: { ticketId: string; subject: string | null; waitingMs: number }[];
};

const NOISE_TAGS = new Set(["automated_notification", "vendor_outreach", "internal", "spam"]);

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}
function stats(values: number[]): ResponseStats {
  const sorted = [...values].sort((a, b) => a - b);
  return { n: sorted.length, medianMs: percentile(sorted, 0.5), p90Ms: percentile(sorted, 0.9) };
}

export function fmtDuration(ms: number | null): string {
  if (ms === null) return "—";
  const m = ms / 60_000;
  if (m < 60) return `${Math.round(m)}m`;
  const h = m / 60;
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

// ---------------------------------------------------------------------------
// Trailing per-day median first-reply trend (the digest chart).

export type TrendPoint = { day: string; n: number; medianMs: number | null };

/** Bucket (replied-at, duration) pairs into one point per calendar day
 *  (America/New_York), oldest→newest, covering every day in the window —
 *  days with no replies carry n=0 / null so the chart shows the gap. */
export function bucketDailyMedians(
  items: { at: Date; ms: number }[],
  days: number,
  now: Date = new Date()
): TrendPoint[] {
  const dayOf = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const buckets = new Map<string, number[]>();
  for (const it of items) {
    const k = dayOf(it.at);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(it.ms);
  }
  const out: TrendPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const k = dayOf(new Date(now.getTime() - i * 86_400_000));
    const v = (buckets.get(k) ?? []).sort((a, b) => a - b);
    out.push({ day: k, n: v.length, medianMs: percentile(v, 0.5) });
  }
  return out;
}

/** First-reply pairs over the trailing window, bucketed by the day the reply
 *  went out. Noise excluded, same as the KPI computation above. */
export async function computeReplyTrend(tenantId: string, days: number): Promise<TrendPoint[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const tickets = await prisma.ticket.findMany({
    where: { tenantId, createdAt: { gte: since } },
    select: {
      tags: true,
      messages: { orderBy: { sentAt: "asc" }, select: { direction: true, sentAt: true } },
    },
  });
  const items: { at: Date; ms: number }[] = [];
  for (const t of tickets) {
    if (t.tags.some((tag) => NOISE_TAGS.has(tag))) continue;
    const firstInbound = t.messages.find((m) => m.direction === "inbound");
    if (!firstInbound) continue;
    const firstReply = t.messages.find((m) => m.direction === "outbound" && m.sentAt >= firstInbound.sentAt);
    if (firstReply) items.push({ at: firstReply.sentAt, ms: firstReply.sentAt.getTime() - firstInbound.sentAt.getTime() });
  }
  return bucketDailyMedians(items, days);
}

export async function computeResponseTimes(tenantId: string, sinceDays = 30): Promise<ResponseTimes> {
  const since = new Date(Date.now() - sinceDays * 86_400_000);
  const [tickets, resolutionEvents] = await Promise.all([
    prisma.ticket.findMany({
      where: { tenantId, createdAt: { gte: since } },
      select: {
        id: true,
        subject: true,
        status: true,
        category: true,
        tags: true,
        createdAt: true,
        assignee: { select: { name: true, email: true } },
        messages: { orderBy: { sentAt: "asc" }, select: { direction: true, sentAt: true } },
      },
    }),
    prisma.auditEvent.findMany({
      where: { tenantId, action: { in: ["ticket_resolved", "ticket_archived"] }, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      select: { entity: true, createdAt: true },
    }),
  ]);
  const resolvedAt = new Map<string, Date>();
  for (const e of resolutionEvents) {
    const id = e.entity.replace("ticket:", "");
    if (!resolvedAt.has(id)) resolvedAt.set(id, e.createdAt);
  }

  const firstReplies: number[] = [];
  const resolutions: number[] = [];
  const byAssignee = new Map<string, number[]>();
  const byCategory = new Map<string, number[]>();
  const awaiting: ResponseTimes["awaitingFirstReply"] = [];
  const now = Date.now();

  for (const t of tickets) {
    if (t.tags.some((tag) => NOISE_TAGS.has(tag))) continue; // noise isn't work
    const firstInbound = t.messages.find((m) => m.direction === "inbound");
    if (!firstInbound) continue;
    const firstReply = t.messages.find(
      (m) => m.direction === "outbound" && m.sentAt >= firstInbound.sentAt
    );
    if (firstReply) {
      const ms = firstReply.sentAt.getTime() - firstInbound.sentAt.getTime();
      firstReplies.push(ms);
      const label = t.assignee ? (t.assignee.name ?? t.assignee.email.split("@")[0]) : "unassigned";
      if (!byAssignee.has(label)) byAssignee.set(label, []);
      byAssignee.get(label)!.push(ms);
      const cat = t.category ?? "other";
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(ms);
    } else if (!INACTIVE_STATUSES.includes(t.status)) {
      awaiting.push({
        ticketId: t.id,
        subject: t.subject,
        waitingMs: now - firstInbound.sentAt.getTime(),
      });
    }
    const res = resolvedAt.get(t.id);
    if (res) resolutions.push(res.getTime() - t.createdAt.getTime());
  }
  awaiting.sort((a, b) => b.waitingMs - a.waitingMs);

  const sortedRes = [...resolutions].sort((a, b) => a - b);
  return {
    sinceDays,
    overall: { ...stats(firstReplies), resolvedN: resolutions.length, medianResolutionMs: percentile(sortedRes, 0.5) },
    byAssignee: [...byAssignee.entries()]
      .map(([label, v]) => ({ label, stats: stats(v) }))
      .sort((a, b) => b.stats.n - a.stats.n),
    byCategory: [...byCategory.entries()]
      .map(([category, v]) => ({ category, stats: stats(v) }))
      .sort((a, b) => b.stats.n - a.stats.n),
    awaitingFirstReply: awaiting.slice(0, 10),
  };
}
