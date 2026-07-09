import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

// @/lib/auth calls NextAuth() at import time; stub the framework pieces so the
// pure crypto helpers can be tested without a NextAuth runtime or the DB.
vi.mock("next-auth", () => ({
  default: vi.fn(() => ({
    handlers: {},
    signIn: vi.fn(),
    signOut: vi.fn(),
    auth: vi.fn(),
    unstable_update: vi.fn(),
  })),
}));
vi.mock("next-auth/providers/credentials", () => ({
  default: vi.fn((config: unknown) => config),
}));
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { hashToken, hashPassword, verifyPassword } from "@/lib/auth";

describe("hashToken", () => {
  it("is deterministic", async () => {
    const a = await hashToken("magic-token-123");
    const b = await hashToken("magic-token-123");
    expect(a).toBe(b);
  });

  it("produces the sha256 hex digest of the token", async () => {
    const token = "magic-token-123";
    const expected = createHash("sha256").update(token).digest("hex");
    const actual = await hashToken(token);
    expect(actual).toBe(expected);
    expect(actual).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for different tokens", async () => {
    expect(await hashToken("token-a")).not.toBe(await hashToken("token-b"));
  });
});

describe("hashPassword / verifyPassword", () => {
  it("roundtrips: a hashed password verifies against itself", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(stored.startsWith("pbkdf2$")).toBe(true);
    await expect(verifyPassword("correct horse battery staple", stored)).resolves.toBe(true);
  });

  it("rejects the wrong password", async () => {
    const stored = await hashPassword("right-password");
    await expect(verifyPassword("wrong-password", stored)).resolves.toBe(false);
  });

  it("rejects a tampered stored hash", async () => {
    const stored = await hashPassword("some-password");
    const parts = stored.split("$"); // ["pbkdf2", iter, saltB64, hashB64]
    const hashB64 = parts[3];
    parts[3] = (hashB64[0] === "A" ? "B" : "A") + hashB64.slice(1);
    await expect(verifyPassword("some-password", parts.join("$"))).resolves.toBe(false);
  });

  it("rejects legacy/garbage stored strings without throwing", async () => {
    await expect(verifyPassword("anything", "plaintext-legacy-value")).resolves.toBe(false);
    await expect(verifyPassword("anything", "$2b$10$abcdefghijklmnopqrstuv")).resolves.toBe(false);
    await expect(verifyPassword("anything", "")).resolves.toBe(false);
  });

  it("salts: hashing the same password twice yields different stored strings", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
    await expect(verifyPassword("same-password", a)).resolves.toBe(true);
    await expect(verifyPassword("same-password", b)).resolves.toBe(true);
  });
});
