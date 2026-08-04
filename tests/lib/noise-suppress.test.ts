import { describe, expect, it, vi } from "vitest";

import { isRepeatNoiseSender, REPEAT_SUPPRESS_CATEGORIES } from "@/lib/noise-suppress";

const dbWithPrior = (n: number) => ({ ticket: { count: vi.fn().mockResolvedValue(n) } });

describe("isRepeatNoiseSender", () => {
  it("suppresses a repeat automated_notification sender", async () => {
    const db = dbWithPrior(3);
    expect(await isRepeatNoiseSender(db, "t1", "c1", "automated_notification")).toBe(true);
    expect(db.ticket.count).toHaveBeenCalledWith({
      where: {
        tenantId: "t1",
        customerId: "c1",
        status: "archived",
        tags: { hasSome: REPEAT_SUPPRESS_CATEGORIES },
      },
    });
  });

  it("does not suppress the sender's FIRST noise thread", async () => {
    expect(await isRepeatNoiseSender(dbWithPrior(0), "t1", "c1", "spam")).toBe(false);
  });

  it("never suppresses internal mail, even with prior archived noise", async () => {
    const db = dbWithPrior(5);
    expect(await isRepeatNoiseSender(db, "t1", "c1", "internal")).toBe(false);
    expect(db.ticket.count).not.toHaveBeenCalled();
  });

  it("never suppresses vendor_outreach or real inquiries", async () => {
    expect(await isRepeatNoiseSender(dbWithPrior(5), "t1", "c1", "vendor_outreach")).toBe(false);
    expect(await isRepeatNoiseSender(dbWithPrior(5), "t1", "c1", "customer_inquiry")).toBe(false);
  });
});
