/** Small shared UI helpers for status/priority/coverage chips. */

export function statusChip(status: string): string {
  const map: Record<string, string> = {
    new: "bg-blue-50 text-blue-700",
    in_review: "bg-amber-50 text-amber-700",
    drafted: "bg-amber-50 text-amber-700",
    replied: "bg-green-50 text-green-700",
    resolved: "bg-green-50 text-green-700",
    archived: "bg-neutral-100 text-neutral-500",
  };
  return map[status] ?? "bg-neutral-100 text-neutral-600";
}

export function coverageChip(coverage: string): string {
  const map: Record<string, string> = {
    full: "bg-green-50 text-green-700",
    partial: "bg-amber-50 text-amber-700",
    none: "bg-red-50 text-red-700",
  };
  return map[coverage] ?? "bg-neutral-100 text-neutral-600";
}

export function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

/** Status transitions a rep can apply by hand — "drafted"/"replied" are
 *  system-set. Drives the status dropdowns on the inbox AND the ticket
 *  header, so the two surfaces always offer the same moves. */
export function statusOptions(current: string): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = [{ value: current, label: statusLabel(current) }];
  if (["new", "in_review", "drafted", "replied"].includes(current)) {
    opts.push({ value: "resolved", label: "→ Resolve" }, { value: "archived", label: "→ Archive" });
  }
  if (["resolved", "archived", "replied"].includes(current)) opts.push({ value: "new", label: "→ Reopen" });
  return opts;
}
