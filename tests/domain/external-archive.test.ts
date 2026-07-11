import { describe, expect, it } from "vitest";
import {
  gmailThreadIsArchived,
  classifyExternalArchive,
  hasNoiseTag,
} from "@/lib/external-archive";

// The Gmail→Concierge archive sweep must never hide live work silently: a
// thread only counts as archived when NO message carries INBOX, and the
// flag/silent split decides whether the inbox asks "did you miss this?".

describe("gmailThreadIsArchived", () => {
  it("is false while any message still sits in INBOX", () => {
    expect(
      gmailThreadIsArchived([
        { labelIds: ["INBOX", "UNREAD"] },
        { labelIds: ["SENT"] },
      ])
    ).toBe(false);
  });

  it("is true when every message lost the INBOX label", () => {
    expect(
      gmailThreadIsArchived([
        { labelIds: ["IMPORTANT", "CATEGORY_PERSONAL"] },
        { labelIds: ["SENT"] },
        { labelIds: null },
      ])
    ).toBe(true);
  });

  it("never guesses on an empty thread (couldn't see it)", () => {
    expect(gmailThreadIsArchived([])).toBe(false);
  });
});

describe("classifyExternalArchive", () => {
  const base = {
    status: "new",
    priority: "normal",
    tags: ["product_question"],
    returnStatus: null,
    lastMessageDirection: "inbound",
  };

  it("flags a ticket whose customer is still waiting on a reply", () => {
    const { flag, reasons } = classifyExternalArchive(base);
    expect(flag).toBe(true);
    expect(reasons).toEqual(["the customer is still waiting on a reply"]);
  });

  it("flags an urgent open ticket even after we replied last", () => {
    const { flag, reasons } = classifyExternalArchive({
      ...base,
      priority: "urgent",
      lastMessageDirection: "outbound",
    });
    expect(flag).toBe(true);
    expect(reasons).toEqual(["the ticket is marked urgent"]);
  });

  it("flags high priority too — including legacy rows where 'high' meant urgent", () => {
    const { flag, reasons } = classifyExternalArchive({
      ...base,
      priority: "high",
      lastMessageDirection: "outbound",
    });
    expect(flag).toBe(true);
    expect(reasons).toEqual(["the ticket is marked high priority"]);
  });

  it("flags an in-flight return regardless of reply state", () => {
    const { flag, reasons } = classifyExternalArchive({
      ...base,
      status: "replied",
      lastMessageDirection: "outbound",
      returnStatus: "label_sent",
    });
    expect(flag).toBe(true);
    expect(reasons).toEqual(["a return is in flight (label sent)"]);
  });

  it("stays silent for an answered ticket waiting on the customer", () => {
    expect(
      classifyExternalArchive({ ...base, status: "replied", lastMessageDirection: "outbound" })
    ).toEqual({ flag: false, reasons: [] });
  });

  it("stays silent for noise even when it would otherwise flag", () => {
    expect(
      classifyExternalArchive({ ...base, priority: "urgent", tags: ["vendor_outreach"] })
    ).toEqual({ flag: false, reasons: [] });
  });
});

describe("hasNoiseTag", () => {
  it("recognizes triage noise categories among the tags", () => {
    expect(hasNoiseTag(["automated_notification"])).toBe(true);
    expect(hasNoiseTag(["warranty", "product:Coopers"])).toBe(false);
  });
});
