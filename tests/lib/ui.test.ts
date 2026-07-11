import { describe, expect, it } from "vitest";
import { statusOptions } from "@/lib/ui";

// One helper drives the status dropdowns on the inbox rows AND the ticket
// header — the rep must get the same moves everywhere. Current status is
// always first (it's the select's value); only rep-settable moves follow.

describe("statusOptions", () => {
  const values = (s: string) => statusOptions(s).map((o) => o.value);

  it("offers Resolve and Archive from every working status", () => {
    for (const s of ["new", "in_review", "drafted"]) {
      expect(values(s)).toEqual([s, "resolved", "archived"]);
    }
  });

  it("offers Resolve, Archive, AND Reopen from replied", () => {
    expect(values("replied")).toEqual(["replied", "resolved", "archived", "new"]);
  });

  it("offers only Reopen from resolved and archived", () => {
    expect(values("resolved")).toEqual(["resolved", "new"]);
    expect(values("archived")).toEqual(["archived", "new"]);
  });

  it("always lists the current status first", () => {
    for (const s of ["new", "in_review", "drafted", "replied", "resolved", "archived"]) {
      expect(statusOptions(s)[0].value).toBe(s);
    }
  });
});
