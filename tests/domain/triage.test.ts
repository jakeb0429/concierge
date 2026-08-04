import { describe, it, expect, vi } from "vitest";

// triage.ts instantiates the Anthropic client at import time with the env
// key — it must exist before the module loads (vi.hoisted runs pre-import).
vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = "test";
});

import { triageDeterministic, urgencyDeterministic, brandContextFor } from "@/lib/triage";

const rheos = brandContextFor("rheos");
const stingray = brandContextFor("stingray");

describe("triageDeterministic", () => {
  it("flags noreply@ senders as automated_notification", () => {
    expect(triageDeterministic("noreply@somestore.com", "Your receipt", rheos)).toBe(
      "automated_notification"
    );
  });

  it("flags notifications@ senders as automated_notification", () => {
    expect(triageDeterministic("notifications@app.example.com", null, rheos)).toBe(
      "automated_notification"
    );
  });

  it("classifies rheosgear.com staff mail as internal under the rheos brand", () => {
    expect(triageDeterministic("kaitlin@rheosgear.com", "Re: warranty", rheos)).toBe("internal");
  });

  it("treats stingrayboats.com as internal only in the stingray context", () => {
    expect(triageDeterministic("service@stingrayboats.com", null, stingray)).toBe("internal");
    expect(triageDeterministic("service@stingrayboats.com", null, rheos)).toBeNull();
  });

  it("flags shipstation.com platform mail as automated_notification", () => {
    expect(triageDeterministic("orders@shipstation.com", "Shipment update", rheos)).toBe(
      "automated_notification"
    );
  });

  it("passes a normal gmail sender through to the model (null)", () => {
    expect(triageDeterministic("jane.doe@gmail.com", "Question about the Coopers", rheos)).toBeNull();
  });

  it("flags Proofpoint quarantine digests as automated_notification (stingray's top noise)", () => {
    expect(triageDeterministic("digest@proofpointessentials.com", "Quarantine Digest", stingray)).toBe(
      "automated_notification"
    );
    expect(triageDeterministic("digest@proofpoint.com", null, stingray)).toBe("automated_notification");
  });

  it("flags facebookmail.com notifications as automated_notification", () => {
    expect(triageDeterministic("notify@facebookmail.com", "New comment", stingray)).toBe(
      "automated_notification"
    );
  });
});

describe("urgencyDeterministic", () => {
  it("marks address changes urgent — they race against shipment", () => {
    expect(urgencyDeterministic("Order #1234", "Can you change my shipping address please?")).toBe(
      true
    );
  });

  it("marks wrong-item reports urgent", () => {
    expect(urgencyDeterministic(null, "You sent me the wrong item")).toBe(true);
  });

  it("marks explicit URGENT subjects urgent", () => {
    expect(urgencyDeterministic("URGENT", "please get back to me")).toBe(true);
  });

  it("leaves a happy note alone", () => {
    expect(urgencyDeterministic("Thank you!", "I love these glasses, best purchase ever")).toBe(
      false
    );
  });
});

describe("brandContextFor", () => {
  it("returns the configured context for known slugs", () => {
    expect(rheos.name).toBe("Rheos");
    expect(rheos.internalDomains).toContain("rheosgear.com");
  });

  it("falls back to a generic brand for unknown slugs", () => {
    const ctx = brandContextFor("acme");
    expect(ctx.name).toBe("acme");
    expect(ctx.blurb).toBe("a consumer brand");
    expect(ctx.internalDomains).toEqual(["scribechs.com"]);
  });
});
