import { describe, expect, it, vi } from "vitest";

// Pure matching/formatting — no DB. Mock the db import the module pulls in.
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { matchArmBrands, armStockLines, type ArmRow } from "@/lib/arm-stock";

const row = (over: Partial<ArmRow>): ArmRow => ({
  id: "x",
  sku: "13003-00100",
  brand: "Bahias",
  container: 1,
  leftCount: 10,
  rightCount: 10,
  ...over,
});

const ROWS: ArmRow[] = [
  row({ brand: "Bahias", sku: "13003-00100" }),
  row({ brand: "Coopers", sku: "13012-00100" }),
  row({ brand: "Biscayne XL", sku: "13038-00120" }),
  row({ brand: "Eddies", sku: "13006-00200", leftCount: 30, rightCount: 1 }),
];

describe("matchArmBrands", () => {
  it("matches a model named in the text (whole word)", () => {
    expect(matchArmBrands(ROWS, "the arm on my Bahias snapped")).toEqual(["Bahias"]);
  });

  it("does NOT match a customer first name that is a model's singular", () => {
    // "Thanks, Eddie" / "- Cooper" must not inject Eddies/Coopers arm stock.
    expect(matchArmBrands(ROWS, "the arm broke. Thanks, Eddie")).toEqual([]);
    expect(matchArmBrands(ROWS, "appreciate it, Cooper")).toEqual([]);
  });

  it("does not match a substring inside another word", () => {
    expect(matchArmBrands(ROWS, "the barrel was coopered")).toEqual([]);
    expect(matchArmBrands(ROWS, "that was a deal breaker")).toEqual([]);
  });

  it("keeps Biscayne XL and Biscaynes separate (no adjacent-model bleed)", () => {
    const withBiscaynes: ArmRow[] = [...ROWS, row({ brand: "Biscaynes", sku: "13019-00100" })];
    // An XL ticket must not also pull regular Biscaynes SKUs.
    expect(matchArmBrands(withBiscaynes, "my Biscayne XL arm snapped")).toEqual(["Biscayne XL"]);
    // A regular-Biscaynes ticket matches only Biscaynes.
    expect(matchArmBrands(withBiscaynes, "my Biscaynes broke")).toEqual(["Biscaynes"]);
  });

  it("prefers the longer/more specific model name first", () => {
    const out = matchArmBrands(ROWS, "my Biscayne XL and my Bahias");
    expect(out[0]).toBe("Biscayne XL");
  });

  it("returns nothing when no known model is named", () => {
    expect(matchArmBrands(ROWS, "my sunglasses broke")).toEqual([]);
  });
});

describe("armStockLines", () => {
  it("lists per-SKU left/right stock for an in-stock model", () => {
    const [line] = armStockLines(ROWS, ["Eddies"]);
    expect(line).toContain("Eddies");
    expect(line).toContain("13006-00200: 30 left, 1 right");
  });

  it("says none on hand when every SKU is zero", () => {
    const zero: ArmRow[] = [row({ brand: "Folly", sku: "13017-00100", leftCount: 0, rightCount: 0 })];
    expect(armStockLines(zero, ["Folly"])[0]).toContain("none on hand");
  });

  it("emits one line per matched brand and skips unmatched", () => {
    expect(armStockLines(ROWS, ["Bahias", "Coopers"])).toHaveLength(2);
    expect(armStockLines(ROWS, ["Nonexistent"])).toHaveLength(0);
  });
});
