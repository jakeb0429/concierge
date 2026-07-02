/**
 * Deterministic thread reply-state — Jake's automatic-rules tagging:
 *   first_contact    — customer wrote, we have never replied on this thread
 *   follow_up        — customer replied again after at least one of our replies
 *   waiting_customer — our reply is the most recent message
 * Computed from message direction history on read, so it is always current.
 */
export type ReplyState = "first_contact" | "follow_up" | "waiting_customer";

export function computeReplyState(
  messages: { direction: string; sentAt: Date | string }[]
): ReplyState {
  const sorted = [...messages].sort((a, b) => String(a.sentAt).localeCompare(String(b.sentAt)));
  if (!sorted.length) return "first_contact";
  const last = sorted[sorted.length - 1];
  if (last.direction === "outbound") return "waiting_customer";
  return sorted.some((m) => m.direction === "outbound") ? "follow_up" : "first_contact";
}

export const REPLY_STATE_LABEL: Record<ReplyState, string> = {
  first_contact: "first contact",
  follow_up: "follow-up",
  waiting_customer: "waiting on customer",
};

export const REPLY_STATE_CHIP: Record<ReplyState, string> = {
  first_contact: "bg-blue-50 text-blue-700",
  follow_up: "bg-amber-50 text-amber-700",
  waiting_customer: "bg-neutral-100 text-neutral-500",
};
