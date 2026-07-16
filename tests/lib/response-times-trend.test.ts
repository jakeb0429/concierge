import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { bucketDailyMedians } from "@/lib/response-times";

const NOW = new Date("2026-07-15T18:00:00-04:00"); // fixed America/New_York afternoon
const at = (iso: string) => new Date(iso);
const H = 3_600_000;

describe("bucketDailyMedians", () => {
  it("returns one point per day, oldest first, covering the whole window", () => {
    const out = bucketDailyMedians([], 5, NOW);
    expect(out).toHaveLength(5);
    expect(out[0].day).toBe("2026-07-11");
    expect(out[4].day).toBe("2026-07-15");
    expect(out.every((p) => p.n === 0 && p.medianMs === null)).toBe(true);
  });

  it("computes the per-day median from that day's replies only", () => {
    const items = [
      { at: at("2026-07-14T10:00:00-04:00"), ms: 1 * H },
      { at: at("2026-07-14T15:00:00-04:00"), ms: 3 * H },
      { at: at("2026-07-14T17:00:00-04:00"), ms: 10 * H },
      { at: at("2026-07-15T09:00:00-04:00"), ms: 2 * H },
    ];
    const out = bucketDailyMedians(items, 3, NOW);
    const d14 = out.find((p) => p.day === "2026-07-14")!;
    const d15 = out.find((p) => p.day === "2026-07-15")!;
    expect(d14.n).toBe(3);
    expect(d14.medianMs).toBe(3 * H);
    expect(d15.n).toBe(1);
    expect(d15.medianMs).toBe(2 * H);
  });

  it("buckets by America/New_York calendar day, not UTC", () => {
    // 11pm ET on the 13th is 3am UTC on the 14th — must land on the 13th.
    const out = bucketDailyMedians([{ at: at("2026-07-13T23:00:00-04:00"), ms: H }], 5, NOW);
    expect(out.find((p) => p.day === "2026-07-13")!.n).toBe(1);
    expect(out.find((p) => p.day === "2026-07-14")!.n).toBe(0);
  });
});
