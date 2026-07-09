import { afterEach, describe, expect, it, vi } from "vitest";
import { isAllowed } from "@/lib/allowlist";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isAllowed", () => {
  it("allows an email on the list", () => {
    vi.stubEnv("AUTH_ALLOWLIST", "a@b.com,c@d.com");
    expect(isAllowed("a@b.com")).toBe(true);
    expect(isAllowed("c@d.com")).toBe(true);
  });

  it("rejects an email not on the list", () => {
    vi.stubEnv("AUTH_ALLOWLIST", "a@b.com,c@d.com");
    expect(isAllowed("intruder@evil.com")).toBe(false);
  });

  it("tolerates whitespace around list entries and the input", () => {
    vi.stubEnv("AUTH_ALLOWLIST", " a@b.com ,  c@d.com,e@f.com ");
    expect(isAllowed("c@d.com")).toBe(true);
    expect(isAllowed("  a@b.com  ")).toBe(true);
  });

  it("matches case-insensitively in both directions", () => {
    vi.stubEnv("AUTH_ALLOWLIST", "Mixed@Case.COM");
    expect(isAllowed("mixed@case.com")).toBe(true);
    expect(isAllowed("MIXED@CASE.COM")).toBe(true);
  });

  it("rejects everything when the allowlist is empty or unset", () => {
    vi.stubEnv("AUTH_ALLOWLIST", "");
    expect(isAllowed("a@b.com")).toBe(false);
    // Empty input must not match the empty entries a bare split produces.
    expect(isAllowed("")).toBe(false);

    vi.stubEnv("AUTH_ALLOWLIST", undefined as unknown as string);
    expect(isAllowed("a@b.com")).toBe(false);
  });
});
