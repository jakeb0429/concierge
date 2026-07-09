import { beforeEach, describe, expect, it, vi } from "vitest";

// sessionUser is wrapped in React cache(), which needs a React request scope;
// passthrough keeps each test call independent (no cross-test memoization).
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: <T,>(fn: T) => fn };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
// Stubbed logger: keeps pino out of the test run and lets the denial-warn
// boundary log (standards §3) be asserted.
const { logWarn } = vi.hoisted(() => ({ logWarn: vi.fn() }));
vi.mock("@/lib/log", () => ({
  logger: { info: vi.fn(), warn: logWarn, error: vi.fn() },
}));

import { auth } from "@/lib/auth";
import { isAdminRole, requireAdmin, sessionUser } from "@/lib/roles";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockAuth.mockReset();
  logWarn.mockReset();
});

describe("isAdminRole", () => {
  it("is true for admin roles", () => {
    expect(isAdminRole("brand_admin")).toBe(true);
    expect(isAdminRole("super_admin")).toBe(true);
  });

  it("is false for non-admin roles and empty values", () => {
    expect(isAdminRole("agent")).toBe(false);
    expect(isAdminRole("team_lead")).toBe(false);
    expect(isAdminRole(null)).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
    expect(isAdminRole("")).toBe(false);
  });
});

describe("sessionUser", () => {
  it("maps the session to a SessionUser", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "u1", email: "agent@brand.com", tenantId: "t1", role: "agent" },
    });
    await expect(sessionUser()).resolves.toEqual({
      id: "u1",
      email: "agent@brand.com",
      tenantId: "t1",
      role: "agent",
    });
  });

  it("returns null when there is no session", async () => {
    mockAuth.mockResolvedValue(null);
    await expect(sessionUser()).resolves.toBeNull();
  });

  it("returns null when the session user lacks id/tenantId", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.com", role: "agent" } });
    await expect(sessionUser()).resolves.toBeNull();
  });

  it("returns null when auth() rejects", async () => {
    mockAuth.mockRejectedValue(new Error("boom"));
    await expect(sessionUser()).resolves.toBeNull();
  });
});

describe("requireAdmin", () => {
  it("throws a 403-shaped error for an agent", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "u1", email: "agent@brand.com", tenantId: "t1", role: "agent" },
    });
    await expect(requireAdmin()).rejects.toMatchObject({
      message: "Admin access required.",
      status: 403,
    });
    expect(logWarn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", role: "agent" }),
      expect.any(String)
    );
  });

  it("throws when there is no session at all", async () => {
    mockAuth.mockResolvedValue(null);
    await expect(requireAdmin()).rejects.toMatchObject({ status: 403 });
  });

  it("returns the user for a brand_admin", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "u2", email: "admin@brand.com", tenantId: "t1", role: "brand_admin" },
    });
    await expect(requireAdmin()).resolves.toEqual({
      id: "u2",
      email: "admin@brand.com",
      tenantId: "t1",
      role: "brand_admin",
    });
  });
});

describe("canSeeSales", () => {
  it("is off for admins and agents without the flag — admin is not enough", async () => {
    const { canSeeSales } = await import("@/lib/roles");
    expect(canSeeSales({ role: "brand_admin", canViewSales: false })).toBe(false);
    expect(canSeeSales({ role: "agent", canViewSales: false })).toBe(false);
    expect(canSeeSales(null)).toBe(false);
  });

  it("is on for flagged users regardless of role, and always for super_admin", async () => {
    const { canSeeSales } = await import("@/lib/roles");
    expect(canSeeSales({ role: "team_lead", canViewSales: true })).toBe(true);
    expect(canSeeSales({ role: "brand_admin", canViewSales: true })).toBe(true);
    expect(canSeeSales({ role: "super_admin", canViewSales: false })).toBe(true);
  });
});
