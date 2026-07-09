import { describe, it, expect, vi } from "vitest";

// returns.ts imports prisma (and related-customers) at module scope — stub the
// db so the test never constructs a client against the production DB.
vi.mock("@/lib/db", () => ({ prisma: {} }));

import {
  evaluateReturnEligibility,
  eligibilityLiveContext,
  detectPurchaseChannel,
  channelGuidance,
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
    channel: "rheosgear",
    channelBasis: "orders on file under this email",
    channelName: null,
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

describe("detectPurchaseChannel", () => {
  const base = { ticketText: "", purchaseChannel: null, channelName: null, d2cCount: 0, b2bCount: 0 };

  it("the customer's message wins: Amazon mention beats orders on file", () => {
    const got = detectPurchaseChannel({ ...base, ticketText: "I bought these on Amazon last month", d2cCount: 3 });
    expect(got.channel).toBe("amazon");
    expect(got.basis).toContain("message");
  });

  it("recognizes an Amazon order id even without the word amazon", () => {
    expect(detectPurchaseChannel({ ...base, ticketText: "order 111-2345678-9012345 arrived scratched" }).channel).toBe("amazon");
  });

  it("orders on file → rheosgear; B2B-only → wholesale", () => {
    expect(detectPurchaseChannel({ ...base, d2cCount: 2 }).channel).toBe("rheosgear");
    expect(detectPurchaseChannel({ ...base, b2bCount: 1 }).channel).toBe("wholesale");
  });

  it("rep-recorded retail/dealer channel when no orders match", () => {
    const got = detectPurchaseChannel({ ...base, purchaseChannel: "retail", channelName: "Half-Moon Outfitters" });
    expect(got.channel).toBe("retail");
    expect(got.basis).toContain("Half-Moon Outfitters");
  });

  it("falls back to unknown", () => {
    expect(detectPurchaseChannel(base).channel).toBe("unknown");
  });
});

describe("channel-aware verdicts", () => {
  it("Amazon purchases go to review with Amazon routing, even in-window", () => {
    const got = evaluateReturnEligibility(facts({ channel: "amazon", channelBasis: "mentioned in the customer's message" }));
    expect(got.verdict).toBe("review");
    expect(got.reasons[0]).toContain("Amazon");
  });

  it("retail purchases go to review naming the retailer", () => {
    const got = evaluateReturnEligibility(
      facts({ channel: "retail", channelName: "Half-Moon Outfitters", orderCount: 0, d2cCount: 0 })
    );
    expect(got.verdict).toBe("review");
    expect(got.reasons[0]).toContain("Half-Moon Outfitters");
  });

  it("liveContext carries the channel and its guidance", () => {
    const f = facts({ channel: "amazon", channelBasis: "mentioned in the customer's message" });
    const lines = eligibilityLiveContext({ verdict: "review", reasons: ["amazon"], facts: f });
    expect(lines.join(" ")).toContain("Purchase channel: amazon");
    expect(lines.join(" ")).toContain("Your Orders");
  });

  it("rheosgear channel adds no guidance line (eligibility reasons carry it)", () => {
    expect(channelGuidance("rheosgear", null)).toBeNull();
    expect(channelGuidance("unknown", null)).toContain("where they bought");
  });
});

describe("eligibilityLiveContext", () => {
  it("leads with the verdict, then channel, then purchase history", () => {
    const f = facts({ orderCount: 3, refundedCount: 1 });
    const lines = eligibilityLiveContext({ verdict: "eligible", reasons: ["in window"], facts: f });
    expect(lines[0]).toContain("ELIGIBLE");
    expect(lines[0]).toContain("system-computed");
    expect(lines[1]).toContain("Purchase channel: rheosgear");
    expect(lines[2]).toContain("3 orders on file");
    expect(lines[2]).toContain("1 previously refunded");
  });

  it("omits the purchase-history line when there are no orders", () => {
    const f = facts({ orderCount: 0, newestRef: null, newestAt: null, daysSinceNewest: null });
    const lines = eligibilityLiveContext({ verdict: "review", reasons: ["no orders"], facts: f });
    expect(lines).toHaveLength(2); // verdict + channel, no history
  });
});
