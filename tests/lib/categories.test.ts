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
  it("gives every canonical category a complete, distinct tint (bg + text + ring)", () => {
    const seen = new Set<string>();
    for (const category of INQUIRY_CATEGORIES) {
      const cls = categoryChipClass(category);
      expect(cls).toMatch(/bg-/);
      expect(cls).toMatch(/text-/);
      expect(cls).toMatch(/ring-/);
      seen.add(cls);
    }
    expect(seen.size).toBe(INQUIRY_CATEGORIES.length); // no two categories share a tint
  });

  it("never uses red — red is reserved for urgency, escalation wears rose", () => {
    for (const category of INQUIRY_CATEGORIES) {
      expect(categoryChipClass(category)).not.toMatch(/\bbg-red|\btext-red/);
    }
  });

  it("falls back to the same neutral tint for unknown/null categories", () => {
    const fallback = categoryChipClass("not_a_category");
    expect(fallback).toMatch(/neutral/);
    expect(categoryChipClass(null)).toBe(fallback);
    expect(categoryChipClass(undefined)).toBe(fallback);
  });
});
