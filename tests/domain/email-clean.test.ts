import { describe, it, expect } from "vitest";
import { cleanEmailText } from "@/lib/email-clean";

describe("cleanEmailText", () => {
  it("passes plain new content through unchanged", () => {
    const raw = "Hi there,\n\nDo the Coopers float in salt water?\n\nThanks,\nJane";
    expect(cleanEmailText(raw)).toBe(raw);
  });

  it('cuts the thread at a Gmail "On ... wrote:" quote header', () => {
    const raw =
      "Yes! The Coopers float.\n\n" +
      "On Tue, Jul 1, 2026 at 9:14 AM Jane Doe <jane@example.com> wrote:\n" +
      "> Do the Coopers float?\n> Thanks";
    expect(cleanEmailText(raw)).toBe("Yes! The Coopers float.");
  });

  it('drops ">"-quoted lines that have no header', () => {
    const raw = "Answers inline below.\n> where is my order\nIt shipped Monday.";
    expect(cleanEmailText(raw)).toBe("Answers inline below.\nIt shipped Monday.");
  });

  it('trims an RFC "--" signature block', () => {
    const raw = "Do you ship to Canada?\n--\nJane Doe\nCharleston, SC";
    expect(cleanEmailText(raw)).toBe("Do you ship to Canada?");
  });

  it('trims a "Sent from my iPhone" mobile signature', () => {
    const raw = "Sounds good, thank you!\n\nSent from my iPhone";
    expect(cleanEmailText(raw)).toBe("Sounds good, thank you!");
  });

  it("falls back to the raw text when the whole message is a forward", () => {
    // The forward header sits at index 0, so the cut removes everything —
    // the fallback keeps the rep from seeing an empty message.
    const raw =
      "---------- Forwarded message ---------\n" +
      "From: Someone <s@example.com>\nSubject: hi\n\nbody of the forward";
    expect(cleanEmailText(raw)).toBe(raw);
  });
});
