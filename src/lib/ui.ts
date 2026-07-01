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
