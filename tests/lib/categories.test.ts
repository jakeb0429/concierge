import { describe, expect, it } from "vitest";
import { categoryChipClass, categoryLabel, INQUIRY_CATEGORIES } from "@/lib/categories";

describe("categoryLabel", () => {
  it("returns the human label for known categories", () => {
    expect(categoryLabel("warranty")).toBe("Warranty");
    expect(categoryLabel("shipping_order_status")).toBe("Shipping & order status");
    expect(categoryLabel("purchasing_po")).toBe("Purchasing & POs");
  });

  it("humanizes unknown categories by replacing underscores", () => {
    expect(categoryLabel("some_new_category")).toBe("some new category");
  });

  it("returns an em dash placeholder for null/undefined/empty", () => {
    expect(categoryLabel(null)).toBe("—");
    expect(categoryLabel(undefined)).toBe("—");
    expect(categoryLabel("")).toBe("—");
  });

  it("has a label for every canonical category", () => {
    for (const category of INQUIRY_CATEGORIES) {
      expect(categoryLabel(category)).not.toContain("_");
    }
  });
});

describe("categoryChipClass", () => {
  it("returns the mapped chip classes for known categories", () => {
    expect(categoryChipClass("warranty")).toBe("bg-amber-50 text-amber-700");
    expect(categoryChipClass("escalation")).toBe("bg-red-50 text-red-700");
  });

  it("falls back to neutral classes for unknown/null categories", () => {
    const fallback = "bg-neutral-100 text-neutral-600";
    expect(categoryChipClass("not_a_category")).toBe(fallback);
    expect(categoryChipClass(null)).toBe(fallback);
    expect(categoryChipClass(undefined)).toBe(fallback);
  });
});
