import { describe, it, expect, vi } from "vitest";

// analytics.ts imports prisma at module scope — stub it so the test never
// constructs a client against the production DB.
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { weeklySeries, monthlySeries, sortCategoryRows, polylinePoints, RETURN_PIPELINE } from "@/lib/analytics";

const DAY = 24 * 3600 * 1000;
const NOW = new Date(2026, 6, 9, 12).getTime(); // fixed clock

describe("weeklySeries", () => {
  it("buckets dates into trailing 7-day windows, oldest first", () => {
    const dates = [
      new Date(NOW - 1 * DAY), // this week
      new Date(NOW - 2 * DAY), // this week
      new Date(NOW - 8 * DAY), // last week
      new Date(NOW - 20 * DAY), // three weeks back
    ];
    const got = weeklySeries(dates, 4, NOW);
    expect(got.map((w) => w.n)).toEqual([0, 1, 1, 2]);
    expect(got).toHaveLength(4);
  });

  it("drops dates outside the window and future dates", () => {
    const got = weeklySeries([new Date(NOW - 30 * DAY), new Date(NOW + DAY)], 4, NOW);
    expect(got.map((w) => w.n)).toEqual([0, 0, 0, 0]);
  });

  it("handles an empty input", () => {
    expect(weeklySeries([], 2, NOW).map((w) => w.n)).toEqual([0, 0]);
  });
});

describe("monthlySeries", () => {
  it("sums amounts into trailing calendar months, oldest first", () => {
    const rows = [
      { at: new Date(Date.UTC(2026, 6, 1)), amount: 100 }, // Jul 26 (current month)
      { at: new Date(Date.UTC(2026, 6, 8)), amount: 50 },
      { at: new Date(Date.UTC(2026, 5, 15)), amount: 200 }, // Jun 26
      { at: new Date(Date.UTC(2025, 6, 20)), amount: 999 }, // Jul 25 — outside a 3-month window
    ];
    const got = monthlySeries(rows, 3, NOW);
    expect(got.map((m) => m.label)).toEqual(["May 26", "Jun 26", "Jul 26"]);
    expect(got.map((m) => m.n)).toEqual([0, 200, 150]);
  });

  it("handles empty input", () => {
    expect(monthlySeries([], 2, NOW).map((m) => m.n)).toEqual([0, 0]);
  });
});

describe("sortCategoryRows", () => {
  const rows = [
    { category: "warranty", n: 10, negative: 1 },
    { category: "returns_exchange", n: 5, negative: 4 },
    { category: "other", n: 20, negative: 0 },
  ];

  it("volume sort is descending by count", () => {
    expect(sortCategoryRows(rows, "volume").map((r) => r.category)).toEqual([
      "other", "warranty", "returns_exchange",
    ]);
  });

  it("negative sort ranks by negative rate, count as tiebreak", () => {
    expect(sortCategoryRows(rows, "negative").map((r) => r.category)).toEqual([
      "returns_exchange", "warranty", "other",
    ]);
  });

  it("does not mutate the input", () => {
    const before = rows.map((r) => r.category);
    sortCategoryRows(rows, "negative");
    expect(rows.map((r) => r.category)).toEqual(before);
  });
});

describe("polylinePoints", () => {
  it("maps values onto the box, max at the top", () => {
    const pts = polylinePoints([0, 10], 100, 50, 0);
    const [p0, p1] = pts.split(" ").map((p) => p.split(",").map(Number));
    expect(p0).toEqual([0, 50]); // zero sits on the baseline
    expect(p1).toEqual([100, 0]); // max touches the top
  });

  it("empty input yields an empty string", () => {
    expect(polylinePoints([], 100, 50)).toBe("");
  });

  it("a single value doesn't divide by zero", () => {
    expect(polylinePoints([5], 100, 50, 0)).toBe("0.0,0.0");
  });

  it("sharedMax puts two series on one scale", () => {
    // series [5] against a shared max of 10 sits at half height, not the top
    const [x, y] = polylinePoints([5], 100, 50, 0, 10).split(",").map(Number);
    expect(x).toBe(0);
    expect(y).toBe(25);
  });
});

describe("RETURN_PIPELINE", () => {
  it("keeps the lifecycle order from the schema comment", () => {
    expect(RETURN_PIPELINE).toEqual([
      "requested", "approved", "label_sent", "package_received", "refunded", "exchanged",
    ]);
  });
});
