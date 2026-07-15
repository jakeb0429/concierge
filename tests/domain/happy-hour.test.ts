import { describe, expect, it, vi } from "vitest";

// happy-hour.ts imports prisma at module scope — stub it so the test never
// constructs a client against the production DB.
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { dedupeKey, isFresh, normalizeArea, parseSpecials } from "@/lib/happy-hour";

const DAY = 86_400_000;

describe("dedupeKey", () => {
  it("is stable across capitalization and punctuation", () => {
    expect(dedupeKey("The Grocery", "$5 Martinis!")).toBe(dedupeKey("the grocery", "$5 martinis"));
  });

  it("distinguishes different deals at the same venue", () => {
    expect(dedupeKey("The Grocery", "$5 martinis")).not.toBe(dedupeKey("The Grocery", "half off appetizers"));
  });
});

describe("normalizeArea", () => {
  it("maps variants onto the two covered areas", () => {
    expect(normalizeArea("Mt. Pleasant")).toBe("Mount Pleasant");
    expect(normalizeArea("Mt Pleasant, SC")).toBe("Mount Pleasant");
    expect(normalizeArea("Mount Pleasant")).toBe("Mount Pleasant");
    expect(normalizeArea("downtown Charleston")).toBe("Charleston");
    expect(normalizeArea("Charleston, SC")).toBe("Charleston");
  });

  it("rejects areas outside coverage", () => {
    expect(normalizeArea("West Ashley")).toBeNull();
    expect(normalizeArea("Summerville")).toBeNull();
  });
});

describe("parseSpecials", () => {
  const valid = {
    venue: "The Grocery",
    area: "Charleston",
    deal: "$5 martinis",
    details: "plus half off select appetizers, Mon-Fri 4-6pm",
    kind: "special",
    source: "Instagram @thegrocerychs",
    sourceUrl: "https://www.instagram.com/thegrocerychs",
  };

  it("reads the fenced json block out of surrounding prose", () => {
    const text = `I searched local announcements.\n\n\`\`\`json\n${JSON.stringify({ specials: [valid] })}\n\`\`\``;
    const out = parseSpecials(text);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      venue: "The Grocery",
      area: "Charleston",
      deal: "$5 martinis",
      kind: "special",
    });
    expect(out[0].dedupeKey).toBe(dedupeKey("The Grocery", "$5 martinis"));
  });

  it("uses the LAST fenced block when several appear", () => {
    const first = { specials: [{ ...valid, venue: "Wrong Venue" }] };
    const last = { specials: [valid] };
    const text = `\`\`\`json\n${JSON.stringify(first)}\n\`\`\`\nRevised:\n\`\`\`json\n${JSON.stringify(last)}\n\`\`\``;
    expect(parseSpecials(text).map((s) => s.venue)).toEqual(["The Grocery"]);
  });

  it("falls back to a bare JSON object with no fence", () => {
    const out = parseSpecials(`Here you go: ${JSON.stringify({ specials: [valid] })}`);
    expect(out).toHaveLength(1);
  });

  it("drops malformed entries without sinking the batch", () => {
    const text = `\`\`\`json\n${JSON.stringify({
      specials: [valid, { venue: "", area: "Charleston", deal: "x" }, { deal: "no venue" }, "junk"],
    })}\n\`\`\``;
    expect(parseSpecials(text)).toHaveLength(1);
  });

  it("drops out-of-area entries and dedupes repeats", () => {
    const text = `\`\`\`json\n${JSON.stringify({
      specials: [valid, { ...valid, venue: "the grocery!", deal: "$5 MARTINIS" }, { ...valid, area: "Summerville" }],
    })}\n\`\`\``;
    expect(parseSpecials(text)).toHaveLength(1);
  });

  it("defaults unknown kind to recurring and discards non-http sourceUrls", () => {
    const text = `\`\`\`json\n${JSON.stringify({
      specials: [{ ...valid, kind: "banana", sourceUrl: "javascript:alert(1)" }],
    })}\n\`\`\``;
    const out = parseSpecials(text);
    expect(out[0].kind).toBe("recurring");
    expect(out[0].sourceUrl).toBeNull();
  });

  it("returns empty on refusals, prose, and broken JSON", () => {
    expect(parseSpecials("I could not find any deals today.")).toEqual([]);
    expect(parseSpecials("```json\n{not json\n```")).toEqual([]);
    expect(parseSpecials(`\`\`\`json\n{"wrong": []}\n\`\`\``)).toEqual([]);
  });
});

describe("isFresh", () => {
  const now = new Date("2026-07-15T12:00:00Z");

  it("keeps a special for 7 days and drops it after", () => {
    expect(isFresh("special", new Date(now.getTime() - 6 * DAY), now)).toBe(true);
    expect(isFresh("special", new Date(now.getTime() - 8 * DAY), now)).toBe(false);
  });

  it("keeps a recurring happy hour for 28 days", () => {
    expect(isFresh("recurring", new Date(now.getTime() - 27 * DAY), now)).toBe(true);
    expect(isFresh("recurring", new Date(now.getTime() - 29 * DAY), now)).toBe(false);
  });

  it("treats unknown kinds as recurring (the safer, longer window)", () => {
    expect(isFresh("mystery", new Date(now.getTime() - 10 * DAY), now)).toBe(true);
  });
});
