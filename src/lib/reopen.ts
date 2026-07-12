/**
 * Shared reopen rule for the intake crons (prisma/intake-gmail.ts,
 * prisma/intake-graph.ts): a customer writing back onto a ticket we consider
 * done — resolved, replied, or (Gmail only) externally archived — must
 * re-surface it as open work, otherwise "actually this didn't fix it" lands
 * invisibly outside the open views.
 */
export function shouldReopenOnInbound(params: {
  status: string;
  tags: string[] | null | undefined;
  /** From address of the LAST message in the thread (any case). */
  lastFromEmail: string | null | undefined;
  mailbox: string;
  /** Gmail mirrors external archives so archived tickets can reopen; Graph does not. */
  allowArchived: boolean;
  /** Noise stays archived: a vendor pitching again is not work. */
  isNoise: (tags: string[] | null | undefined) => boolean;
}): boolean {
  const { status, tags, lastFromEmail, mailbox, allowArchived, isNoise } = params;
  // Last word is ours — nothing new came in, nothing to reopen. A missing
  // from address counts as inbound, matching the crons' direction logic.
  if (lastFromEmail?.toLowerCase() === mailbox.toLowerCase()) return false;
  if (status === "resolved" || status === "replied") return true;
  return allowArchived && status === "archived" && !isNoise(tags);
}
