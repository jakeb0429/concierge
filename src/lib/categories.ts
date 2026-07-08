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
