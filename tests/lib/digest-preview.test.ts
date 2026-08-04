import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { ticketPreview } from "@/lib/digest";

describe("ticketPreview", () => {
  it("strips the external-sender caution banner and collapses whitespace", () => {
    const raw =
      "Caution: This message was sent from outside the company. Please do not click links or open attachments unless you recognize the sender and verify the content is safe.   \n\n  Good morning, I own a 2011 Stingray 208LR.";
    expect(ticketPreview(raw)).toBe("Good morning, I own a 2011 Stingray 208LR.");
  });

  it("caps long messages with an ellipsis", () => {
    const raw = "word ".repeat(100);
    const out = ticketPreview(raw, 60);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith("…")).toBe(true);
  });

  it("is empty-safe", () => {
    expect(ticketPreview(null)).toBe("");
    expect(ticketPreview("")).toBe("");
  });
});
