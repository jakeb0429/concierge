/** Small shared UI helpers for status/priority/coverage chips. */

export function statusChip(status: string): string {
  const map: Record<string, string> = {
    new: "bg-blue-50 text-blue-800 ring-blue-600/20",
    customer_replied: "bg-orange-50 text-orange-800 ring-orange-600/20",
    in_review: "bg-amber-50 text-amber-800 ring-amber-600/20",
    drafted: "bg-amber-50 text-amber-800 ring-amber-600/20",
    awaiting_internal: "bg-purple-50 text-purple-700 ring-purple-600/20",
    replied: "bg-green-50 text-green-800 ring-green-600/20",
    waiting_on_customer: "bg-slate-100 text-slate-600 ring-slate-500/20",
    resolved: "bg-emerald-50 text-emerald-800 ring-emerald-600/20",
    archived: "bg-neutral-100 text-neutral-500 ring-neutral-500/15",
  };
  return map[status] ?? "bg-neutral-100 text-neutral-600 ring-neutral-500/15";
}

export function coverageChip(coverage: string): string {
  const map: Record<string, string> = {
    full: "bg-green-50 text-green-800 ring-green-600/20",
    partial: "bg-amber-50 text-amber-800 ring-amber-600/20",
    none: "bg-rose-50 text-rose-800 ring-rose-600/20",
  };
  return map[coverage] ?? "bg-neutral-100 text-neutral-600 ring-neutral-500/15";
}

export function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

/** Status transitions a rep can apply by hand — "drafted"/"replied" are
 *  system-set. Drives the status dropdowns on the inbox AND the ticket
 *  header, so the two surfaces always offer the same moves.
 *  "→ Waiting on customer" parks a ticket out of the active queue (like a
 *  reply went out) without resolving it; it reopens on a customer write-back. */
export function statusOptions(current: string): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = [{ value: current, label: statusLabel(current) }];
  const active = ["new", "customer_replied", "in_review", "drafted", "replied", "waiting_on_customer"].includes(current);
  if (active) {
    if (current !== "waiting_on_customer") {
      opts.push({ value: "waiting_on_customer", label: "→ Waiting on customer" });
    }
    opts.push({ value: "resolved", label: "→ Resolve" }, { value: "archived", label: "→ Archive" });
  }
  if (["resolved", "archived", "replied", "waiting_on_customer"].includes(current)) {
    opts.push({ value: "new", label: "→ Reopen" });
  }
  return opts;
}
