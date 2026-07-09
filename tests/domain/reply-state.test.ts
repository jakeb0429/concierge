import { describe, it, expect } from "vitest";
import { computeReplyState } from "@/lib/reply-state";

describe("computeReplyState", () => {
  it("sorts chronologically, not by date-string — outbound later in time wins even when its string sorts first", () => {
    // Regression: "Fri Jul 10 2026..." sorts BEFORE "Sun Jul 05 2026..." as a
    // string, and the array order puts the inbound last. Both a lexicographic
    // sort and no sort at all would return follow_up; only a getTime() sort
    // sees the outbound as most recent.
    const state = computeReplyState([
      { direction: "outbound", sentAt: "Fri Jul 10 2026 09:00:00 GMT-0400" },
      { direction: "inbound", sentAt: "Sun Jul 05 2026 09:00:00 GMT-0400" },
    ]);
    expect(state).toBe("waiting_customer");
  });

  it("returns first_contact when there is no outbound message", () => {
    const state = computeReplyState([
      { direction: "inbound", sentAt: "2026-07-01T12:00:00Z" },
      { direction: "inbound", sentAt: "2026-07-02T12:00:00Z" },
    ]);
    expect(state).toBe("first_contact");
  });

  it("returns follow_up when the customer wrote after our reply", () => {
    const state = computeReplyState([
      { direction: "inbound", sentAt: "2026-07-01T12:00:00Z" },
      { direction: "outbound", sentAt: "2026-07-01T15:00:00Z" },
      { direction: "inbound", sentAt: "2026-07-02T09:00:00Z" },
    ]);
    expect(state).toBe("follow_up");
  });

  it("returns first_contact for an empty thread", () => {
    expect(computeReplyState([])).toBe("first_contact");
  });

  it("accepts a mix of ISO strings and Date objects", () => {
    const state = computeReplyState([
      { direction: "inbound", sentAt: "2026-07-05T13:00:00Z" },
      { direction: "outbound", sentAt: new Date("2026-07-10T13:00:00Z") },
    ]);
    expect(state).toBe("waiting_customer");
  });
});
