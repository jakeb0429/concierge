import { beforeEach, describe, expect, it, vi } from "vitest";

// Magic-link gates: the response NEVER reveals membership (success:true either
// way) and the in-memory rate bucket caps 3 link sends per email per hour.
// The bucket is module state, so each test uses its own email address.
const { prisma, sendMagicLink, isAllowed, getCurrentTenant, hashToken } = vi.hoisted(() => ({
  prisma: { user: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() } },
  sendMagicLink: vi.fn(),
  isAllowed: vi.fn(),
  getCurrentTenant: vi.fn(),
  hashToken: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/email", () => ({ sendMagicLink, sendEmail: vi.fn() }));
vi.mock("@/lib/allowlist", () => ({ isAllowed }));
vi.mock("@/lib/tenant", () => ({ getCurrentTenant }));
// @/lib/auth boots NextAuth at import time — stub the one function used here.
vi.mock("@/lib/auth", () => ({ hashToken }));

const { POST } = await import("@/app/api/auth/magic-link/route");

const req = (email: string) =>
  new Request("http://localhost:3014/api/auth/magic-link", { method: "POST", body: JSON.stringify({ email }) });

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentTenant.mockResolvedValue({ id: "t1", slug: "rheos" });
  hashToken.mockImplementation(async (t: string) => `hashed:${t}`);
  prisma.user.update.mockResolvedValue({});
  sendMagicLink.mockResolvedValue(undefined);
});

describe("POST /api/auth/magic-link", () => {
  it("sends a link to a provisioned user (token stored hashed, 1h expiry)", async () => {
    prisma.user.findFirst.mockResolvedValue({ id: "u1", email: "rep@rheos.com" });
    const res = await POST(req("rep@rheos.com"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(sendMagicLink).toHaveBeenCalledTimes(1);
    const { email, url } = sendMagicLink.mock.calls[0][0] as { email: string; url: string };
    expect(email).toBe("rep@rheos.com");
    expect(url).toContain("/api/auth/magic-link/verify?token=");
    // Only the hash lands in the DB — the raw token exists only in the email.
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: expect.objectContaining({
        magicLinkToken: expect.stringMatching(/^hashed:/),
        magicLinkExpires: expect.any(Date),
      }),
    });
  });

  it("answers success:true for an unknown, non-allowlisted email without sending anything", async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    isAllowed.mockReturnValue(false);
    const res = await POST(req("stranger@nowhere.com"));
    expect(await res.json()).toEqual({ success: true }); // never reveal membership
    expect(sendMagicLink).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("rate-limits the 4th request in an hour: still success:true, but no 4th send", async () => {
    prisma.user.findFirst.mockResolvedValue({ id: "u2", email: "burst@rheos.com" });
    for (let i = 0; i < 3; i++) {
      expect((await POST(req("burst@rheos.com"))).status).toBe(200);
    }
    expect(sendMagicLink).toHaveBeenCalledTimes(3);

    const fourth = await POST(req("burst@rheos.com"));
    expect(await fourth.json()).toEqual({ success: true }); // indistinguishable to the caller
    expect(sendMagicLink).toHaveBeenCalledTimes(3); // no new send
    expect(prisma.user.findFirst).toHaveBeenCalledTimes(3); // brake fires before any DB work
  });
});
