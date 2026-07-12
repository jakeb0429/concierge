import { describe, expect, it } from "vitest";
import {
  SUN_COLLECTIVE_FOOTER,
  promoFooterForCategory,
  appendPromoFooter,
  stripPromoFooter,
} from "@/lib/brain/promo-footer";

const JOIN_URL = "https://www.rheosgear.com/products/sun-collective-1m";
const occurrences = (s: string, sub: string) =>
  s.split(sub).length - 1;

describe("promoFooterForCategory", () => {
  it("returns the footer for Exchange and Warranty tickets", () => {
    expect(promoFooterForCategory("returns_exchange")).toBe(SUN_COLLECTIVE_FOOTER);
    expect(promoFooterForCategory("warranty")).toBe(SUN_COLLECTIVE_FOOTER);
  });

  it("returns null for every other (or missing) category", () => {
    for (const c of ["shipping_order_status", "product_question", "wholesale", "other", "", null, undefined]) {
      expect(promoFooterForCategory(c)).toBeNull();
    }
  });
});

describe("SUN_COLLECTIVE_FOOTER copy", () => {
  it("states the real offer and join link, with no em dash", () => {
    expect(SUN_COLLECTIVE_FOOTER).toContain("50% off every Rheos pair");
    expect(SUN_COLLECTIVE_FOOTER).toContain("free premium travel case on your first order");
    expect(SUN_COLLECTIVE_FOOTER).toContain("$5 a month");
    expect(SUN_COLLECTIVE_FOOTER).toContain(JOIN_URL);
    // Em dashes are banned in customer-facing text (scrubber in draft.ts).
    expect(SUN_COLLECTIVE_FOOTER).not.toContain("—");
  });
});

describe("appendPromoFooter", () => {
  it("appends the footer to an eligible draft, separated by a blank line", () => {
    const out = appendPromoFooter("Here is how to start your exchange.", "returns_exchange");
    expect(out).toBe(`Here is how to start your exchange.\n\n${SUN_COLLECTIVE_FOOTER}`);
  });

  it("leaves ineligible categories untouched", () => {
    const body = "Your order shipped yesterday.";
    expect(appendPromoFooter(body, "shipping_order_status")).toBe(body);
    expect(appendPromoFooter(body, null)).toBe(body);
  });

  it("is idempotent — never stacks the promo on a regenerated draft", () => {
    const once = appendPromoFooter("Warranty claim steps.", "warranty");
    const twice = appendPromoFooter(once, "warranty");
    expect(twice).toBe(once);
    expect(occurrences(twice, JOIN_URL)).toBe(1);
  });

  it("normalizes a stale/edited footer back to the canonical one", () => {
    // Simulate a body that already carries the canonical footer plus extra prose.
    const stale = `Warranty steps.\n\n${SUN_COLLECTIVE_FOOTER}\n\nthanks`;
    const out = appendPromoFooter(stale, "warranty");
    // Exactly one canonical footer, at the end.
    expect(occurrences(out, JOIN_URL)).toBe(1);
    expect(out.endsWith(SUN_COLLECTIVE_FOOTER)).toBe(true);
  });

  it("strips a leftover footer when the ticket is no longer eligible", () => {
    const withFooter = `Body.\n\n${SUN_COLLECTIVE_FOOTER}`;
    expect(appendPromoFooter(withFooter, "shipping_order_status")).toBe("Body.");
  });

  it("trims trailing whitespace before appending so spacing is consistent", () => {
    const out = appendPromoFooter("Reply body.   \n\n", "warranty");
    expect(out).toBe(`Reply body.\n\n${SUN_COLLECTIVE_FOOTER}`);
  });
});

describe("stripPromoFooter", () => {
  it("removes the footer and the blank line before it", () => {
    expect(stripPromoFooter(`Body text.\n\n${SUN_COLLECTIVE_FOOTER}`)).toBe("Body text.");
  });

  it("returns the body unchanged when there is no footer", () => {
    expect(stripPromoFooter("Just a normal reply.")).toBe("Just a normal reply.");
  });
});
