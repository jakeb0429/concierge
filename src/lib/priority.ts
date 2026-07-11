/**
 * Ticket priority — the four-level urgency scale, rep-editable everywhere a
 * ticket shows (Jake's 2026-07-11 ask: triage over-flagged a routine parts
 * question as urgent, and nothing in the UI could demote it).
 *
 *   urgent — races against time: address changes, cancel-before-ship,
 *            wrong/missing orders, explicit ASAP. Red band, pinned first.
 *   high   — time-sensitive or upset, but not racing a shipment.
 *   medium — a real question worth answering soon.
 *   normal — no time pressure.
 *
 * History: before 2026-07-11 the scale was binary — "high" meant what
 * "urgent" means now. Migration 20260711_priority_four_levels renamed the
 * stored values; anything still reading "high" as urgent is legacy.
 */
export const PRIORITIES = ["urgent", "high", "medium", "normal"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  normal: "Normal",
};

/** Importance sort weight — higher sorts first. Unknown/legacy values → 0. */
export function priorityWeight(p: string | null | undefined): number {
  const w: Record<string, number> = { urgent: 3, high: 2, medium: 1, normal: 0 };
  return w[p ?? ""] ?? 0;
}

/** Chip classes follow the heat of the level; normal stays quiet. Urgent is
 *  a red TINT with a dot (see priorityDot) — the old solid-red block shouted
 *  louder than it informed. The red row-edge still carries the alarm. */
export function priorityChip(p: string | null | undefined): string {
  const map: Record<string, string> = {
    urgent: "bg-red-50 text-red-800 ring-red-600/30",
    high: "bg-orange-50 text-orange-800 ring-orange-600/25",
    medium: "bg-amber-50 text-amber-800 ring-amber-600/20",
    normal: "bg-neutral-100 text-neutral-500 ring-neutral-500/15",
  };
  return map[p ?? ""] ?? "bg-neutral-100 text-neutral-500 ring-neutral-500/15";
}

/** Dot color paired with priorityChip for non-select chips. */
export function priorityDot(p: string | null | undefined): string {
  const map: Record<string, string> = {
    urgent: "bg-red-600",
    high: "bg-orange-500",
    medium: "bg-amber-500",
    normal: "bg-neutral-300",
  };
  return map[p ?? ""] ?? "bg-neutral-300";
}

export function isPriority(p: string | null | undefined): p is Priority {
  return (PRIORITIES as readonly string[]).includes(p ?? "");
}
