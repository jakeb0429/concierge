import { describe, it, expect, vi } from "vitest";

// returns.ts imports prisma (and related-customers) at module scope — stub the
// db so the test never constructs a client against the production DB.
vi.mock("@/lib/db", () => ({ prisma: {} }));

import {
  evaluateReturnEligibility,
  eligibilityLiveContext,
  RETURN_WINDOW_DAYS,
  type ReturnFacts,
} from "@/lib/returns";

function facts(overrides: Partial<ReturnFacts> = {}): ReturnFacts {
  return {
    orderCount: 1,
    newestRef: "80986",
    newestAt: new Date(2026, 4, 18),
    daysSinceNewest: 52,
    refundedCount: 0,
    d2cCount: 1,
    b2bCount: 0,
    relatedHint: null,
    ...overrides,
  };
}

describe("evaluateReturnEligibility", () => {
  it("eligible inside the 365-day window", () => {
    const got = evaluateReturnEligibility(facts());
    expect(got.verdict).toBe("eligible");
    expect(got.reasons[0]).toContain("#80986");
    expect(got.reasons[0]).toContain(`${RETURN_WINDOW_DAYS}-day`);
  });

  it("ineligible outside the window", () => {
    const got = evaluateReturnEligibility(facts({ daysSinceNewest: 400 }));
    expect(got.verdict).toBe("ineligible");
    expect(got.reasons[0]).toContain("outside");
  });

  it("boundary: day 365 is still inside, day 366 is not", () => {
    expect(evaluateReturnEligibility(facts({ daysSinceNewest: 365 })).verdict).toBe("eligible");
    expect(evaluateReturnEligibility(facts({ daysSinceNewest: 366 })).verdict).toBe("ineligible");
  });

  it("repeat refunds flip an in-window return to review", () => {
    const got = evaluateReturnEligibility(facts({ refundedCount: 2 }));
    expect(got.verdict).toBe("review");
    expect(got.reasons.join(" ")).toContain("2 previously refunded");
  });

  it("no orders → review, carrying the household hint when present", () => {
    const got = evaluateReturnEligibility(
      facts({ orderCount: 0, newestRef: null, newestAt: null, daysSinceNewest: null, relatedHint: "possible household match under klanglie21@gmail.com" })
    );
    expect(got.verdict).toBe("review");
    expect(got.reasons.join(" ")).toContain("klanglie21@gmail.com");
    expect(got.reasons.join(" ")).toContain("verify the purchase");
  });

  it("B2B-only accounts route to wholesale review, even in-window", () => {
    const got = evaluateReturnEligibility(facts({ d2cCount: 0, b2bCount: 3 }));
    expect(got.verdict).toBe("review");
    expect(got.reasons[0]).toContain("wholesale");
  });

  it("mixed D2C+B2B follows the normal D2C rules", () => {
    expect(evaluateReturnEligibility(facts({ b2bCount: 1, d2cCount: 1, orderCount: 2 })).verdict).toBe("eligible");
  });
});

describe("eligibilityLiveContext", () => {
  it("leads with the verdict and includes purchase history when orders exist", () => {
    const f = facts({ orderCount: 3, refundedCount: 1 });
    const lines = eligibilityLiveContext({ verdict: "eligible", reasons: ["in window"], facts: f });
    expect(lines[0]).toContain("ELIGIBLE");
    expect(lines[0]).toContain("system-computed");
    expect(lines[1]).toContain("3 orders on file");
    expect(lines[1]).toContain("1 previously refunded");
  });

  it("omits the purchase-history line when there are no orders", () => {
    const f = facts({ orderCount: 0, newestRef: null, newestAt: null, daysSinceNewest: null });
    const lines = eligibilityLiveContext({ verdict: "review", reasons: ["no orders"], facts: f });
    expect(lines).toHaveLength(1);
  });
});
