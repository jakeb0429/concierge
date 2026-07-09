/**
 * Analytics aggregation for the /analytics page — live Concierge tickets
 * (volume, replies, returns pipeline, per-rep activity) alongside the mined
 * 365-day AnalyticsInquiry history. Pure bucketing/sorting helpers are
 * exported separately so they're testable without a database.
 */

import { prisma } from "./db";
import { nowMs } from "./time";

const WEEK_MS = 7 * 24 * 3600 * 1000;

export type WeekPoint = { label: string; start: Date; n: number };

const weekLabel = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Bucket timestamps into `weeks` trailing 7-day windows ending now. Pure. */
export function weeklySeries(dates: Date[], weeks: number, now = nowMs()): WeekPoint[] {
  const out: WeekPoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(now - (i + 1) * WEEK_MS);
    out.push({ label: weekLabel(start), start, n: 0 });
  }
  for (const d of dates) {
    const age = now - d.getTime();
    if (age < 0 || age >= weeks * WEEK_MS) continue;
    const idx = weeks - 1 - Math.floor(age / WEEK_MS);
    out[idx].n++;
  }
  return out;
}

export type CategorySort = "volume" | "negative";
export type CategoryRow = { category: string; n: number; negative: number };

/** Sort category rows by volume or by negative-outcome rate. Pure. */
export function sortCategoryRows(rows: CategoryRow[], sort: CategorySort): CategoryRow[] {
  const negRate = (r: CategoryRow) => (r.n ? r.negative / r.n : 0);
  return [...rows].sort((a, b) => (sort === "negative" ? negRate(b) - negRate(a) || b.n - a.n : b.n - a.n));
}

/** SVG polyline points for a mini line chart (0..w x 0..h, y down). Pure.
 *  Pass `sharedMax` when several series must sit on ONE y-scale. */
export function polylinePoints(values: number[], w: number, h: number, pad = 2, sharedMax?: number): string {
  if (!values.length) return "";
  const max = Math.max(1, sharedMax ?? 0, ...values);
  const stepX = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  return values
    .map((v, i) => `${(pad + i * stepX).toFixed(1)},${(h - pad - (v / max) * (h - pad * 2)).toFixed(1)}`)
    .join(" ");
}

/** The return lifecycle in pipeline order (Phase A sets only "requested"). */
export const RETURN_PIPELINE = [
  "requested",
  "approved",
  "label_sent",
  "package_received",
  "refunded",
  "exchanged",
] as const;

export type TicketAnalytics = {
  newByWeek: WeekPoint[];
  repliesByWeek: WeekPoint[];
  returnsPipeline: { status: string; n: number }[];
  openByCategory: CategoryRow[]; // negative = urgent count here
  mailboxMix: { label: string; n: number }[];
};

/** Live-ticket aggregates over the trailing `weeks` window. */
export async function ticketAnalytics(tenantId: string, weeks: number): Promise<TicketAnalytics> {
  const since = new Date(nowMs() - weeks * WEEK_MS);
  const [created, replies, returns, open, channels] = await Promise.all([
    prisma.ticket.findMany({
      where: { tenantId, createdAt: { gte: since } },
      select: { createdAt: true },
    }),
    prisma.auditEvent.findMany({
      where: { tenantId, action: { in: ["reply_sent", "ticket_replied_external"] }, createdAt: { gte: since } },
      select: { createdAt: true },
    }),
    prisma.ticket.groupBy({
      by: ["returnStatus"],
      where: { tenantId, returnStatus: { not: null } },
      _count: true,
    }),
    prisma.ticket.groupBy({
      by: ["category", "priority"],
      where: { tenantId, status: { in: ["new", "drafted", "in_review"] } },
      _count: true,
    }),
    prisma.ticket.groupBy({
      by: ["channelId"],
      where: { tenantId, createdAt: { gte: since } },
      _count: true,
    }),
  ]);

  const byCat = new Map<string, CategoryRow>();
  for (const row of open) {
    const key = row.category ?? "other";
    const cur = byCat.get(key) ?? { category: key, n: 0, negative: 0 };
    cur.n += row._count;
    if (row.priority === "high") cur.negative += row._count;
    byCat.set(key, cur);
  }

  const channelIds = channels.map((c) => c.channelId).filter((v): v is string => !!v);
  const channelRows = channelIds.length
    ? await prisma.channel.findMany({ where: { id: { in: channelIds } }, select: { id: true, supportAddress: true } })
    : [];
  const channelLabel = new Map(channelRows.map((c) => [c.id, c.supportAddress ?? c.id]));

  return {
    newByWeek: weeklySeries(created.map((t) => t.createdAt), weeks),
    repliesByWeek: weeklySeries(replies.map((r) => r.createdAt), weeks),
    returnsPipeline: RETURN_PIPELINE.map((status) => ({
      status,
      n: returns.find((r) => r.returnStatus === status)?._count ?? 0,
    })).filter((r) => r.n > 0),
    openByCategory: sortCategoryRows([...byCat.values()], "volume"),
    mailboxMix: channels
      .map((c) => ({ label: c.channelId ? (channelLabel.get(c.channelId) ?? "unknown") : "unknown", n: c._count }))
      .sort((a, b) => b.n - a.n),
  };
}

export type MyStats = {
  openAssigned: number;
  inReview: number;
  repliesSent30d: number;
  returnsInFlight: number;
};

/** The signed-in rep's personal queue + activity. */
export async function myStats(tenantId: string, userId: string): Promise<MyStats> {
  const since = new Date(nowMs() - 30 * 24 * 3600 * 1000);
  const [openAssigned, inReview, repliesSent30d, returnsInFlight] = await Promise.all([
    prisma.ticket.count({
      where: { tenantId, assigneeId: userId, status: { in: ["new", "drafted", "in_review"] } },
    }),
    prisma.ticket.count({ where: { tenantId, assigneeId: userId, status: "in_review" } }),
    prisma.auditEvent.count({
      where: { tenantId, actorId: userId, action: "reply_sent", createdAt: { gte: since } },
    }),
    prisma.ticket.count({
      where: { tenantId, assigneeId: userId, returnStatus: { not: null }, status: { notIn: ["resolved", "archived"] } },
    }),
  ]);
  return { openAssigned, inReview, repliesSent30d, returnsInFlight };
}
