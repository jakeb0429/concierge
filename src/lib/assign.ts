import { prisma } from "./db";

/**
 * Specialty-based auto-assignment. A ticket's fine-grained category is matched
 * against User.specialties; among matching specialists the LEAST-LOADED one
 * (fewest open assigned tickets) wins — deterministic load balancing without
 * round-robin state. No specialist match → the ticket stays unassigned and
 * lands in the triage admin's queue.
 *
 * Auto-assignment is a SUGGESTION with teeth: it sets assigneeId so the
 * ticket shows up in the specialist's view immediately, but the triage admin
 * sees every assignment and overrides freely (that override is itself signal
 * for tuning specialties).
 */

/** Ticket statuses that count toward a user's current workload. */
const OPEN_STATUSES_EXCLUDED = ["archived", "resolved", "replied"];

export async function autoAssign(
  tenantId: string,
  ticketId: string,
  category: string | null
): Promise<{ userId: string; email: string } | null> {
  if (!category) return null;
  const specialists = await prisma.user.findMany({
    where: { tenantId, specialties: { has: category } },
    select: { id: true, email: true },
    orderBy: { createdAt: "asc" }, // stable tie-break
  });
  if (specialists.length === 0) return null;

  let chosen = specialists[0];
  if (specialists.length > 1) {
    const loads = await prisma.ticket.groupBy({
      by: ["assigneeId"],
      where: {
        tenantId,
        assigneeId: { in: specialists.map((s) => s.id) },
        status: { notIn: OPEN_STATUSES_EXCLUDED },
      },
      _count: true,
    });
    const loadOf = new Map(loads.map((l) => [l.assigneeId, l._count]));
    chosen = [...specialists].sort(
      (a, b) => (loadOf.get(a.id) ?? 0) - (loadOf.get(b.id) ?? 0)
    )[0];
  }

  await prisma.ticket.update({ where: { id: ticketId }, data: { assigneeId: chosen.id } });
  await prisma.auditEvent.create({
    data: {
      tenantId,
      action: "auto_assigned",
      entity: `ticket:${ticketId}`,
      meta: { category, assignee: chosen.email },
    },
  });
  return { userId: chosen.id, email: chosen.email };
}
