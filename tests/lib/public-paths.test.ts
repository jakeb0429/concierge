import { describe, expect, it } from "vitest";
import { PUBLIC_EXACT, PUBLIC_PREFIXES, isPublic } from "@/lib/public-paths";

// Pins the middleware auth surface: exactly these paths skip the session check.
// Any change to PUBLIC_EXACT / PUBLIC_PREFIXES must update this file on purpose.
describe("isPublic", () => {
  it("allows the exact public paths", () => {
    expect(isPublic("/login")).toBe(true);
    expect(isPublic("/favicon.ico")).toBe(true);
    expect(isPublic("/robots.txt")).toBe(true);
    expect(isPublic("/scribe-mark.png")).toBe(true);
  });

  it("protects app and API routes", () => {
    expect(isPublic("/")).toBe(false);
    expect(isPublic("/tickets/x")).toBe(false);
    expect(isPublic("/api/tickets/x")).toBe(false);
  });

  it("allows NextAuth and Next.js internals by prefix", () => {
    expect(isPublic("/api/auth")).toBe(true);
    expect(isPublic("/api/auth/callback/credentials")).toBe(true);
    expect(isPublic("/_next/static/chunk.js")).toBe(true);
  });

  it("does not extend exact matches into prefixes", () => {
    expect(isPublic("/loginx")).toBe(false);
    expect(isPublic("/login/extra")).toBe(false);
  });

  it("prefix match uses bare startsWith — /api/authx IS public today", () => {
    // Characterization, not endorsement: isPublic's third clause is
    // startsWith(p) with no "/" boundary, so any path merely beginning with
    // "/api/auth" (e.g. a hypothetical /api/authx route) bypasses auth. No
    // such route exists; if one is ever added, tighten isPublic first.
    expect(isPublic("/api/authx")).toBe(true);
  });

  it("exports the expected surface (guards accidental additions)", () => {
    expect([...PUBLIC_EXACT].sort()).toEqual(
      ["/favicon.ico", "/login", "/robots.txt", "/scribe-mark.png"].sort()
    );
    expect(PUBLIC_PREFIXES).toEqual(["/api/auth", "/_next"]);
  });
});
