/**
 * Ticket status vocabulary — one definition shared by server code and client
 * components (standalone, no server deps) so "which statuses count as active
 * work" never drifts across the ~10 places that branch on it.
 *
 *   new | drafted | in_review     — needs our action (active queue)
 *   replied | waiting_on_customer  — we acted; the ball is in the customer's court
 *   resolved | archived            — done
 *
 * "waiting_on_customer" is a manual sibling of "replied": a rep sets it by hand
 * (answered off-channel, or asked the customer for something) to move a ticket
 * out of the active queue. Like "replied", it reopens when the customer writes
 * back (see src/lib/reopen.ts).
 */
export const TICKET_STATUSES = [
  "new",
  "drafted",
  "in_review",
  "awaiting_internal",
  "replied",
  "waiting_on_customer",
  "resolved",
  "archived",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/**
 * Statuses that are NOT awaiting our reply — excluded from every active / open
 * / needs-a-reply query and count. Use this instead of an inline array so a
 * new "waiting" status is honored everywhere at once.
 */
export const INACTIVE_STATUSES: string[] = [
  "archived",
  "resolved",
  "replied",
  "waiting_on_customer",
  // The agent asked a teammate and is waiting on their answer — not the rep's
  // action, so it stays out of the needs-a-reply queue until the answer lands.
  "awaiting_internal",
];
