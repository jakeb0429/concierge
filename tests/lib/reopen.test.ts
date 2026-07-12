import { describe, expect, it } from "vitest";
import { hasNoiseTag } from "@/lib/external-archive";
import { shouldReopenOnInbound } from "@/lib/reopen";

// A customer writing back onto a "done" ticket must re-surface it as open
// work. The two parameterizations mirror the intake crons exactly:
// intake-gmail.ts mirrors external archives so archived tickets can reopen;
// intake-graph.ts deliberately stays resolved/replied only.

const MAILBOX = "hello@rheosgear.com";
const CUSTOMER = "customer@example.com";

const gmail = (over: { status: string; tags?: string[]; lastFromEmail?: string | null }) =>
  shouldReopenOnInbound({
    status: over.status,
    tags: over.tags ?? [],
    lastFromEmail: over.lastFromEmail === undefined ? CUSTOMER : over.lastFromEmail,
    mailbox: MAILBOX,
    allowArchived: true,
    isNoise: (tags) => hasNoiseTag(tags ?? []),
  });

const graph = (over: { status: string; lastFromEmail?: string | null }) =>
  shouldReopenOnInbound({
    status: over.status,
    tags: null,
    lastFromEmail: over.lastFromEmail === undefined ? CUSTOMER : over.lastFromEmail,
    mailbox: MAILBOX,
    allowArchived: false,
    isNoise: () => false,
  });

describe("shouldReopenOnInbound", () => {
  it("reopens a replied ticket when the customer writes back (both crons)", () => {
    expect(gmail({ status: "replied" })).toBe(true);
    expect(graph({ status: "replied" })).toBe(true);
  });

  it("reopens a resolved ticket when the customer writes back (both crons)", () => {
    expect(gmail({ status: "resolved" })).toBe(true);
    expect(graph({ status: "resolved" })).toBe(true);
  });

  it("keeps noise archived — a vendor pitching again is not work (gmail params)", () => {
    expect(gmail({ status: "archived", tags: ["vendor_outreach"] })).toBe(false);
    expect(gmail({ status: "archived", tags: ["spam"] })).toBe(false);
  });

  it("reopens a non-noise archived ticket only where archived reopen is allowed", () => {
    expect(gmail({ status: "archived", tags: ["customer_inquiry", "gmail_archived"] })).toBe(true);
    // Graph doesn't mirror external archives — archived there was on purpose.
    expect(graph({ status: "archived" })).toBe(false);
  });

  it("never reopens when the last message is from the mailbox itself", () => {
    for (const status of ["replied", "resolved", "archived"]) {
      expect(gmail({ status, lastFromEmail: MAILBOX })).toBe(false);
      expect(graph({ status, lastFromEmail: MAILBOX })).toBe(false);
    }
    // Gmail From headers vary in case — still ours.
    expect(gmail({ status: "replied", lastFromEmail: "Hello@RheosGear.com" })).toBe(false);
  });

  it("leaves working statuses alone — reopen is a done→open transition only", () => {
    for (const status of ["new", "drafted", "in_review"]) {
      expect(gmail({ status })).toBe(false);
      expect(graph({ status })).toBe(false);
    }
  });

  it("treats a missing last-from address as inbound, matching the crons' direction logic", () => {
    expect(gmail({ status: "replied", lastFromEmail: null })).toBe(true);
    expect(graph({ status: "resolved", lastFromEmail: null })).toBe(true);
  });
});
