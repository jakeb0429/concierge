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
  /** Did we ever reply on this thread? A prior outbound means it's a real
   *  conversation we engaged — so a customer write-back reopens it even if the
   *  classifier mislabeled it noise. A never-answered noise thread (a cold
   *  vendor blast writing again) stays archived. */
  hasPriorOutbound: boolean;
}): boolean {
  const { status, tags, lastFromEmail, mailbox, allowArchived, isNoise, hasPriorOutbound } = params;
  // Last word is ours — nothing new came in, nothing to reopen. A missing
  // from address counts as inbound, matching the crons' direction logic.
  if (lastFromEmail?.toLowerCase() === mailbox.toLowerCase()) return false;
  if (status === "resolved" || status === "replied" || status === "waiting_on_customer") return true;
  // Archived reopens when it isn't noise — OR when it is noise but we already
  // engaged it (mislabeled real thread, like a support chain the classifier
  // tagged automated_notification).
  return allowArchived && status === "archived" && (!isNoise(tags) || hasPriorOutbound);
}
