import { prisma } from "./db";

/**
 * Context notes for a ticket = its own notes + its customer's notes.
 * "Active" = no expiration or not yet expired — expired notes drop out of
 * draft grounding immediately (review keeps the queue honest, but drafts
 * never wait on it).
 */
export async function notesForTicket(tenantId: string, ticketId: string, customerId: string) {
  const notes = await prisma.contextNote.findMany({
    where: { tenantId, OR: [{ ticketId }, { customerId }] },
    orderBy: { createdAt: "desc" },
  });
  const now = Date.now();
  return notes.map((n) => ({
    id: n.id,
    body: n.body,
    scope: n.ticketId ? ("ticket" as const) : ("customer" as const),
    expiresAt: n.expiresAt,
    expired: !!n.expiresAt && n.expiresAt.getTime() < now,
  }));
}

/** Active-note lines for draft grounding. */
export async function groundingNotes(tenantId: string, ticketId: string, customerId: string): Promise<string[]> {
  const notes = await notesForTicket(tenantId, ticketId, customerId);
  return notes
    .filter((n) => !n.expired)
    .map(
      (n) =>
        `${n.body}${n.expiresAt ? ` (valid until ${n.expiresAt.toISOString().slice(0, 10)})` : ""}`
    );
}
