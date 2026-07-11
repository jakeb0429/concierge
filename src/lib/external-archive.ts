import { NOISE_CATEGORIES } from "./triage";

/**
 * External-archive sync — the Gmail→Concierge half of archive mirroring
 * (src/lib/archive.ts is the Concierge→Gmail half). The intake cron sweeps
 * open tickets, and any thread archived in the real mailbox toggles its
 * ticket off here too. Archives that still looked like live work get flagged
 * so the inbox can ask "did you miss this?" instead of hiding them silently.
 */

/** Provenance tag: this ticket was archived because its Gmail thread was. */
export const GMAIL_ARCHIVED_TAG = "gmail_archived";
/** Warning tag: the Gmail-side archive looked like a mistake — surface it. */
export const MISSED_ARCHIVE_TAG = "missed_archive";

const NOISE = new Set<string>(NOISE_CATEGORIES);
const WORKING_STATUSES = ["new", "drafted", "in_review"];
const ACTIVE_RETURN_STATUSES = ["requested", "approved", "label_sent", "package_received"];

export function hasNoiseTag(tags: string[]): boolean {
  return tags.some((t) => NOISE.has(t));
}

/**
 * A Gmail thread is archived when NO message still carries the INBOX label
 * (outbound-only messages never have it, but every ticketed thread was
 * created from an INBOX message — losing the label means someone archived).
 * An empty message list means we couldn't see the thread — never guess.
 */
export function gmailThreadIsArchived(messages: { labelIds?: string[] | null }[]): boolean {
  if (!messages.length) return false;
  return messages.every((m) => !(m.labelIds ?? []).includes("INBOX"));
}

/**
 * Should this Gmail-side archive worry anyone? Noise the triage already
 * routed out is housekeeping. Everything else is judged on whether the
 * ticket still looked like live work at the moment it disappeared.
 */
export function classifyExternalArchive(t: {
  status: string;
  priority: string;
  tags: string[];
  returnStatus: string | null;
  lastMessageDirection: string | null;
}): { flag: boolean; reasons: string[] } {
  if (hasNoiseTag(t.tags)) return { flag: false, reasons: [] };
  const reasons: string[] = [];
  if (t.lastMessageDirection === "inbound" && WORKING_STATUSES.includes(t.status))
    reasons.push("the customer is still waiting on a reply");
  // "high" also flags pre-migration rows, where it meant today's "urgent".
  if (["urgent", "high"].includes(t.priority) && WORKING_STATUSES.includes(t.status))
    reasons.push(`the ticket is marked ${t.priority === "urgent" ? "urgent" : "high priority"}`);
  if (t.returnStatus && ACTIVE_RETURN_STATUSES.includes(t.returnStatus))
    reasons.push(`a return is in flight (${t.returnStatus.replace(/_/g, " ")})`);
  return { flag: reasons.length > 0, reasons };
}
