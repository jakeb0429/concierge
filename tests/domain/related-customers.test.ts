import { describe, it, expect, vi } from "vitest";

// related-customers.ts imports prisma at module scope — stub it out so the
// test never constructs a client against the production DB.
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { lastNameOf, addressKey, rankCandidates, type OrderIdentity } from "@/lib/related-customers";

function order(overrides: Partial<OrderIdentity> = {}): OrderIdentity {
  return {
    email: "someone@example.com",
    orderedAt: new Date(2026, 4, 2),
    totalAmount: 100,
    buyerName: null,
    shipName: null,
    shipAddress1: null,
    shipZip: null,
    ...overrides,
  };
}

const kristoffer = { email: "langliekristoffer@gmail.com", lastName: "langlie" };

describe("lastNameOf", () => {
  it("takes the last word, lowercased", () => {
    expect(lastNameOf("Kristoffer Langlie")).toBe("langlie");
  });
  it("needs at least two words (a bare first name has no surname)", () => {
    expect(lastNameOf("Kristoffer")).toBeNull();
  });
  it("rejects short or empty leftovers", () => {
    expect(lastNameOf("Bo Li")).toBeNull(); // 2-char surname: too noisy to match on
    expect(lastNameOf(null)).toBeNull();
    expect(lastNameOf("  ")).toBeNull();
  });
  it("strips punctuation but keeps hyphens and apostrophes", () => {
    expect(lastNameOf("Mary O'Brien-Smith.")).toBe("o'brien-smith");
  });
});

describe("addressKey", () => {
  it("normalizes case, punctuation, and ZIP+4", () => {
    expect(addressKey("123 Main St.", "29401-1234")).toBe("123mainst|29401");
    expect(addressKey("123 MAIN ST", "29401")).toBe("123mainst|29401");
  });
  it("returns null when either half is missing", () => {
    expect(addressKey("123 Main St", null)).toBeNull();
    expect(addressKey(null, "29401")).toBeNull();
  });
});

describe("rankCandidates", () => {
  it("matches a similar email containing the last name", () => {
    const got = rankCandidates(kristoffer, [], [order({ email: "klanglie21@gmail.com" })]);
    expect(got).toHaveLength(1);
    expect(got[0].email).toBe("klanglie21@gmail.com");
    expect(got[0].reasons).toEqual(["email"]);
  });

  it("matches a ship-to or buyer name on a whole-word basis only", () => {
    const hit = rankCandidates(kristoffer, [], [order({ email: "a@b.com", shipName: "Anna Langlie" })]);
    expect(hit[0]?.reasons).toContain("name");
    // "Langlies" is a different word — no match
    const miss = rankCandidates(kristoffer, [], [order({ email: "a@b.com", shipName: "The Langlies" })]);
    expect(miss).toHaveLength(0);
  });

  it("matches a shared shipping address against the customer's own orders", () => {
    const own = [order({ email: kristoffer.email, shipAddress1: "12 Harbor Ln", shipZip: "29401" })];
    const got = rankCandidates(kristoffer, own, [
      order({ email: "spouse@x.com", shipAddress1: "12 Harbor Ln.", shipZip: "29401-8542" }),
    ]);
    expect(got[0]?.reasons).toEqual(["address"]);
  });

  it("never returns the customer's own email and requires some reason", () => {
    const got = rankCandidates(kristoffer, [], [
      order({ email: kristoffer.email, shipName: "Kristoffer Langlie" }),
      order({ email: "stranger@x.com", shipName: "Someone Else" }),
    ]);
    expect(got).toHaveLength(0);
  });

  it("aggregates a candidate's orders and ranks address matches first", () => {
    const own = [order({ email: kristoffer.email, shipAddress1: "12 Harbor Ln", shipZip: "29401" })];
    const got = rankCandidates(kristoffer, own, [
      order({ email: "cousin@x.com", shipName: "Bo Langlie", totalAmount: 900 }),
      order({ email: "spouse@x.com", shipAddress1: "12 Harbor Ln", shipZip: "29401", totalAmount: 50 }),
      order({ email: "spouse@x.com", shipAddress1: "12 Harbor Ln", shipZip: "29401", totalAmount: 60, orderedAt: new Date(2026, 5, 1) }),
    ]);
    expect(got.map((g) => g.email)).toEqual(["spouse@x.com", "cousin@x.com"]);
    expect(got[0].orderCount).toBe(2);
    expect(got[0].ltv).toBe(110);
    expect(got[0].lastOrderedAt).toEqual(new Date(2026, 5, 1));
  });

  it("drops name-based matches when the surname is too common, keeps address hits", () => {
    const own = [order({ email: "j@smith.com", shipAddress1: "1 Elm", shipZip: "10001" })];
    const smiths = Array.from({ length: 30 }, (_, i) =>
      order({ email: `smith${i}@x.com`, shipName: `Pat Smith` })
    );
    const got = rankCandidates({ email: "j@smith.com", lastName: "smith" }, own, [
      ...smiths,
      order({ email: "partner@x.com", shipAddress1: "1 Elm", shipZip: "10001" }),
    ]);
    expect(got).toHaveLength(1);
    expect(got[0].email).toBe("partner@x.com");
  });

  it("skips email-similarity for 3-letter surnames but still name-matches them", () => {
    const got = rankCandidates({ email: "a@b.com", lastName: "lee" }, [], [
      order({ email: "leeann@x.com" }), // "lee" inside the local part — too noisy
      order({ email: "c@d.com", shipName: "Dana Lee" }),
    ]);
    expect(got).toHaveLength(1);
    expect(got[0].reasons).toEqual(["name"]);
  });
});
