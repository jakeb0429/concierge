import type { TriageCategory } from "@/lib/triage";

/**
 * Repeat-noise suppression: a sender whose mail was already archived as a
 * digest/newsletter shouldn't mint a fresh archived ticket per thread
 * (Proofpoint quarantine digests alone created 33 tickets in 6 days).
 *
 * The FIRST noise thread from a sender still creates one archived ticket —
 * that's the audit trail. Later noise threads from the same sender are
 * dropped before ticket creation.
 *
 * Deliberately narrower than NOISE_CATEGORIES: "internal" mail is never
 * suppressed (a forwarded customer inquiry can look internal), and
 * "vendor_outreach" stays visible ticket-by-ticket.
 */
export const REPEAT_SUPPRESS_CATEGORIES: TriageCategory[] = [
  "automated_notification",
  "spam",
];

/** Structural type so intake scripts (own PrismaClient) and tests both fit. */
type TicketCounter = {
  ticket: { count(args: { where: Record<string, unknown> }): Promise<number> };
};

export async function isRepeatNoiseSender(
  db: TicketCounter,
  tenantId: string,
  customerId: string,
  category: TriageCategory
): Promise<boolean> {
  if (!REPEAT_SUPPRESS_CATEGORIES.includes(category)) return false;
  const prior = await db.ticket.count({
    where: {
      tenantId,
      customerId,
      status: "archived",
      tags: { hasSome: REPEAT_SUPPRESS_CATEGORIES },
    },
  });
  return prior > 0;
}
