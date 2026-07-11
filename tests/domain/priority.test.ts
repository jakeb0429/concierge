import { describe, expect, it } from "vitest";
import { PRIORITIES, PRIORITY_LABEL, priorityWeight, priorityChip, isPriority } from "@/lib/priority";

// The four-level urgency scale: ordering drives the inbox importance sort,
// and unknown/legacy values must degrade quietly instead of crashing a page.

describe("priority scale", () => {
  it("orders urgent > high > medium > normal", () => {
    const weights = PRIORITIES.map(priorityWeight);
    expect(weights).toEqual([...weights].sort((a, b) => b - a));
    expect(priorityWeight("urgent")).toBeGreaterThan(priorityWeight("high"));
    expect(priorityWeight("high")).toBeGreaterThan(priorityWeight("medium"));
    expect(priorityWeight("medium")).toBeGreaterThan(priorityWeight("normal"));
  });

  it("every level has a label and a chip", () => {
    for (const p of PRIORITIES) {
      expect(PRIORITY_LABEL[p]).toBeTruthy();
      expect(priorityChip(p)).toMatch(/bg-/);
    }
  });

  it("degrades unknown and legacy values to the quiet default", () => {
    expect(priorityWeight("vip")).toBe(0); // retired pre-2026-07-11 value
    expect(priorityWeight(null)).toBe(0);
    expect(priorityChip("low")).toBe(priorityChip("normal"));
    expect(isPriority("vip")).toBe(false);
    expect(isPriority("urgent")).toBe(true);
  });
});
