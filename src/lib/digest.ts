import { prisma } from "./db";
import { computeResponseTimes, type ResponseTimes } from "./response-times";
import { categoryLabel } from "./categories";

/**
 * The operational digest — one data object rendered two ways (the /digest
 * page and the emailed report). daily = last 24h, weekly = last 7 days.
 */

export type DigestPeriod = "daily" | "weekly";

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
      where: { tenantId, action: { in: ["signal_approved", "answer_promoted", "user_updated"] }, createdAt: { gte: since } },
    }),
    prisma.ticket.findMany({
      where: { tenantId, status: { notIn: ["archived", "resolved", "replied"] } },
      select: { priority: true, messages: { orderBy: { sentAt: "desc" }, take: 1, select: { direction: true } } },
    }),
    prisma.ticket.count({
      where: { tenantId, status: { notIn: ["archived", "resolved", "replied"] }, assigneeId: null },
    }),
    prisma.learningSignal.count({ where: { tenantId, status: "open" } }),
    prisma.contextNote.count({ where: { tenantId, expiresAt: { lt: new Date() } } }),
    prisma.ticket.groupBy({
      by: ["assigneeId"],
      where: { tenantId, assigneeId: { not: null }, status: { notIn: ["archived", "resolved", "replied"] } },
      _count: true,
    }),
    prisma.user.findMany({ where: { tenantId }, select: { id: true, name: true, email: true } }),
    computeResponseTimes(tenantId, period === "daily" ? 7 : 30), // KPI window wider than the digest window
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
    urgentOpen: openTickets.filter((t) => t.priority === "high").length,
    unassigned,
    trainingOpen,
    expiredNotes,
    workload: workloadRaw
      .map((w) => ({ label: userLabel.get(w.assigneeId!) ?? "?", n: w._count }))
      .sort((a, b) => b.n - a.n),
    responseTimes,
  };
}
