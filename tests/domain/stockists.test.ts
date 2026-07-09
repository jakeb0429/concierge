import { describe, it, expect, vi } from "vitest";

// stockists.ts imports prisma at module scope — stub it out so the test
// never constructs a client against the production DB.
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { stockistLines, type StockistHit } from "@/lib/stockists";

// Local-time constructor keeps toLocaleDateString stable across timezones.
const may2 = new Date(2026, 4, 2);

function hit(overrides: Partial<StockistHit> = {}): StockistHit {
  return {
    companyName: "Half-Moon Outfitters",
    city: "Charleston",
    state: "SC",
    lastOrderedAt: may2,
    totalQty: 12,
    products: [],
    ...overrides,
  };
}

describe("stockistLines", () => {
  it("names the family when the search was family-scoped", () => {
    expect(stockistLines([hit()], "Coopers")).toEqual([
      "Half-Moon Outfitters (Charleston, SC) — last wholesale order May 2, 2026, 12 units of Coopers",
    ]);
  });

  it("lists the account's own families when no family was requested", () => {
    const lines = stockistLines([hit({ products: ["Coopers", "Bahias", "Eddies"] })]);
    expect(lines[0]).toBe(
      "Half-Moon Outfitters (Charleston, SC) — last wholesale order May 2, 2026, 12 units across Coopers/Bahias/Eddies"
    );
  });

  it("uses the singular unit for a quantity of one", () => {
    expect(stockistLines([hit({ totalQty: 1 })], "Coopers")[0]).toContain("1 unit of Coopers");
    expect(stockistLines([hit({ totalQty: 1 })], "Coopers")[0]).not.toContain("units");
  });

  it("omits the location parens and product suffix when data is missing", () => {
    const lines = stockistLines([hit({ city: null, state: null })]);
    expect(lines[0]).toBe("Half-Moon Outfitters — last wholesale order May 2, 2026, 12 units");
  });

  it("keeps the state when only the city is missing", () => {
    expect(stockistLines([hit({ city: null })], "Coopers")[0]).toContain("(SC)");
  });
});
