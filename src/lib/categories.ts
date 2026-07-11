/**
 * The canonical fine-grained inquiry taxonomy — shared by ticket routing,
 * user specialties, brain training, and analytics (AnalyticsInquiry uses the
 * same names, minus the two routing-only ones: purchasing_po + escalation).
 * Standalone module (no server deps) so client components can import it.
 */
export const INQUIRY_CATEGORIES = [
  "warranty",
  "replacement_parts",
  "shipping_order_status",
  "returns_exchange",
  "sizing_fit",
  "product_question",
  "wholesale",
  "marketing_collab",
  "purchasing_po",
  "escalation",
  "other",
] as const;
export type InquiryCategory = (typeof INQUIRY_CATEGORIES)[number];

export const INQUIRY_CATEGORY_LABEL: Record<InquiryCategory, string> = {
  warranty: "Warranty",
  replacement_parts: "Replacement parts",
  shipping_order_status: "Shipping & order status",
  returns_exchange: "Returns & exchanges",
  sizing_fit: "Sizing & fit",
  product_question: "Product questions",
  wholesale: "Wholesale / B2B",
  marketing_collab: "Marketing & partnerships",
  purchasing_po: "Purchasing & POs",
  escalation: "Escalations & approvals",
  other: "Other",
};

export function categoryLabel(category: string | null | undefined): string {
  if (!category) return "—";
  return INQUIRY_CATEGORY_LABEL[category as InquiryCategory] ?? category.replace(/_/g, " ");
}

/** Consistent category colors across inbox chips + ticket headers.
 *  Curated for even lightness and mutual distinction (tinted bg, 800 text,
 *  soft inset ring). Red is deliberately ABSENT — red means urgent, nothing
 *  else; escalation wears rose so the two never blur. */
export const INQUIRY_CATEGORY_CHIP: Record<string, string> = {
  warranty: "bg-amber-50 text-amber-800 ring-amber-600/20",
  replacement_parts: "bg-orange-50 text-orange-800 ring-orange-600/20",
  shipping_order_status: "bg-sky-50 text-sky-800 ring-sky-600/20",
  returns_exchange: "bg-violet-50 text-violet-800 ring-violet-600/20",
  sizing_fit: "bg-pink-50 text-pink-800 ring-pink-600/20",
  product_question: "bg-emerald-50 text-emerald-800 ring-emerald-600/20",
  wholesale: "bg-indigo-50 text-indigo-800 ring-indigo-600/20",
  marketing_collab: "bg-fuchsia-50 text-fuchsia-800 ring-fuchsia-600/20",
  purchasing_po: "bg-slate-100 text-slate-700 ring-slate-600/20",
  escalation: "bg-rose-50 text-rose-800 ring-rose-600/20",
  other: "bg-neutral-100 text-neutral-600 ring-neutral-500/15",
};
export function categoryChipClass(category: string | null | undefined): string {
  return INQUIRY_CATEGORY_CHIP[category ?? ""] ?? "bg-neutral-100 text-neutral-600 ring-neutral-500/15";
}
