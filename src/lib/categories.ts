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

/** Consistent category colors across inbox chips + ticket headers. */
export const INQUIRY_CATEGORY_CHIP: Record<string, string> = {
  warranty: "bg-amber-50 text-amber-700",
  replacement_parts: "bg-orange-50 text-orange-700",
  shipping_order_status: "bg-blue-50 text-blue-700",
  returns_exchange: "bg-violet-50 text-violet-700",
  sizing_fit: "bg-pink-50 text-pink-700",
  product_question: "bg-emerald-50 text-emerald-700",
  wholesale: "bg-purple-50 text-purple-700",
  marketing_collab: "bg-fuchsia-50 text-fuchsia-700",
  purchasing_po: "bg-slate-100 text-slate-700",
  escalation: "bg-red-50 text-red-700",
  other: "bg-neutral-100 text-neutral-600",
};
export function categoryChipClass(category: string | null | undefined): string {
  return INQUIRY_CATEGORY_CHIP[category ?? ""] ?? "bg-neutral-100 text-neutral-600";
}
