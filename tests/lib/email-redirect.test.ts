import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Pre-live safety valve: while EMAIL_REDIRECT_TO is set, sendEmail reroutes
// every notification to that one address (real recipients preserved in the
// subject) so nothing reaches a teammate/customer before go-live. Mailgun is
// mocked via a stubbed global fetch — no real network.
vi.mock("@/lib/log", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));

const { sendEmail } = await import("@/lib/email");

const fetchMock = vi.fn();

function lastMailgunTo(): string {
  const call = fetchMock.mock.calls.at(-1)!;
  const body = call[1].body as URLSearchParams;
  return body.get("to") ?? "";
}
function lastMailgunSubject(): string {
  const body = fetchMock.mock.calls.at(-1)![1].body as URLSearchParams;
  return body.get("subject") ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "ok" });
  vi.stubEnv("MAILGUN_API_KEY", "key-123");
  vi.stubEnv("MAILGUN_DOMAIN", "mg.example.com");
});
afterEach(() => vi.unstubAllEnvs());

const msg = {
  to: ["dana@rheosgear.com", "sam@rheosgear.com"],
  subject: "Your Concierge question was answered",
  text: "Here is the answer.",
  html: "<p>Here is the answer.</p>",
};

describe("sendEmail pre-live redirect", () => {
  it("reroutes to EMAIL_REDIRECT_TO and preserves the real recipients in the subject", async () => {
    vi.stubEnv("EMAIL_REDIRECT_TO", "jake@rheosgear.com");
    const ok = await sendEmail(msg);
    expect(ok).toBe(true);
    // Recipients replaced by the single redirect address...
    expect(lastMailgunTo()).toBe("jake@rheosgear.com");
    // ...but who it WOULD have gone to is still visible.
    expect(lastMailgunSubject()).toContain("dana@rheosgear.com, sam@rheosgear.com");
    expect(lastMailgunSubject()).toContain("Your Concierge question was answered");
  });

  it("passes recipients through untouched when the valve is off", async () => {
    vi.stubEnv("EMAIL_REDIRECT_TO", "");
    const ok = await sendEmail(msg);
    expect(ok).toBe(true);
    expect(lastMailgunTo()).toBe("dana@rheosgear.com,sam@rheosgear.com");
    expect(lastMailgunSubject()).toBe("Your Concierge question was answered");
  });

  it("trims whitespace-only redirect values as 'off'", async () => {
    vi.stubEnv("EMAIL_REDIRECT_TO", "   ");
    await sendEmail(msg);
    expect(lastMailgunTo()).toBe("dana@rheosgear.com,sam@rheosgear.com");
  });
});
