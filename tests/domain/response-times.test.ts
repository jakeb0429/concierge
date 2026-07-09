import { describe, it, expect, vi } from "vitest";

// response-times.ts imports prisma at module scope — stub it out so the test
// never constructs a client against the production DB.
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { fmtDuration } from "@/lib/response-times";

const MIN = 60_000;
const HOUR = 60 * MIN;

describe("fmtDuration", () => {
  it("renders null as an em dash placeholder", () => {
    expect(fmtDuration(null)).toBe("—");
  });

  it("renders sub-hour durations in whole minutes", () => {
    expect(fmtDuration(0)).toBe("0m");
    expect(fmtDuration(5 * MIN)).toBe("5m");
    expect(fmtDuration(59 * MIN)).toBe("59m");
  });

  it("switches to hours at 60 minutes, with one decimal under 10h", () => {
    expect(fmtDuration(60 * MIN)).toBe("1.0h");
    expect(fmtDuration(90 * MIN)).toBe("1.5h");
  });

  it("drops the decimal from 10h up", () => {
    expect(fmtDuration(12 * HOUR)).toBe("12h");
    expect(fmtDuration(47 * HOUR)).toBe("47h");
  });

  it("switches to days at 48 hours", () => {
    expect(fmtDuration(48 * HOUR)).toBe("2.0d");
    expect(fmtDuration(84 * HOUR)).toBe("3.5d");
  });
});
