import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel } from "@prisma/client";
import { sendReply } from "@/lib/send";

// sendReply's real transport path is getChannelAdapter -> GmailAdapter, which
// builds its client straight from googleapis (not @/lib/gmail-client). Mocking
// googleapis at the root means that even if the CONCIERGE_LIVE_SEND gate or the
// mock-ticket guard regressed, no test could ever reach Google — the send spy
// would just record the breach and fail the assertion.
const { messagesSend, gmailCtor, logInfo } = vi.hoisted(() => {
  const messagesSend = vi.fn();
  const gmailCtor = vi.fn(() => ({ users: { messages: { send: messagesSend } } }));
  return { messagesSend, gmailCtor, logInfo: vi.fn() };
});
vi.mock("googleapis", () => ({
  google: { auth: { JWT: vi.fn() }, gmail: gmailCtor },
}));
// gmailFor is the other Gmail entry point in the codebase; stub it to the same
// spy so no path out of this test can construct a live client.
vi.mock("@/lib/gmail-client", () => ({
  gmailFor: vi.fn(() => ({ users: { messages: { send: messagesSend } } })),
}));
// sendReply doesn't touch the DB today; the mock stands guard so a future
// import in the send path can never open a connection to the .env (production)
// database from tests.
vi.mock("@/lib/db", () => ({ db: {} }));
// Stubbed logger: keeps pino (and its pretty transport) out of the test run
// and lets the assertions read the recipient + live flag off the log context.
vi.mock("@/lib/log", () => ({
  logger: { info: logInfo, warn: vi.fn(), error: vi.fn() },
}));

const channel = {
  id: "ch1",
  tenantId: "t1",
  provider: "gmail",
  supportAddress: "hello@rheosgear.com",
  cursor: null,
  watchExpiresAt: null,
  active: true,
} as Channel;

const baseArgs = {
  channel,
  inReplyToMessageId: "msg-1",
  to: "customer@example.com",
  html: "<p>hi</p>",
  subject: "Re: order",
};

const ENV_KEYS = ["CONCIERGE_LIVE_SEND", "RHEOS_GMAIL_CLIENT_EMAIL", "RHEOS_GMAIL_PRIVATE_KEY"];
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.clearAllMocks();
});

describe("sendReply CONCIERGE_LIVE_SEND gate", () => {
  it("logs instead of sending when the flag is unset, even with credentials present", async () => {
    delete process.env.CONCIERGE_LIVE_SEND;
    // Credentials resolvable — proving the flag alone is what blocks the send.
    process.env.RHEOS_GMAIL_CLIENT_EMAIL = "svc@project.iam.gserviceaccount.com";

    const res = await sendReply({ ...baseArgs, providerThreadId: "thread-123" });

    expect(res.live).toBe(false);
    expect(res.providerMessageId).toMatch(/^stub-/);
    expect(messagesSend).not.toHaveBeenCalled();
    expect(gmailCtor).not.toHaveBeenCalled();
    expect(logInfo).toHaveBeenCalledWith(
      expect.objectContaining({ to: "customer@example.com", live: false, mode: "stub" }),
      expect.any(String)
    );
  });

  it('logs instead of sending when the flag is "false"', async () => {
    process.env.CONCIERGE_LIVE_SEND = "false";
    process.env.RHEOS_GMAIL_CLIENT_EMAIL = "svc@project.iam.gserviceaccount.com";

    const res = await sendReply({ ...baseArgs, providerThreadId: "thread-123" });

    expect(res).toEqual({ providerMessageId: expect.stringMatching(/^stub-/), live: false });
    expect(messagesSend).not.toHaveBeenCalled();
    expect(gmailCtor).not.toHaveBeenCalled();
  });

  it("never transmits mock tickets, even with the flag on and credentials present", async () => {
    process.env.CONCIERGE_LIVE_SEND = "true";
    process.env.RHEOS_GMAIL_CLIENT_EMAIL = "svc@project.iam.gserviceaccount.com";
    process.env.RHEOS_GMAIL_PRIVATE_KEY = "fake-key";

    const res = await sendReply({ ...baseArgs, providerThreadId: "mock-abc123" });

    expect(res.live).toBe(false);
    expect(res.providerMessageId).toMatch(/^stub-/);
    expect(messagesSend).not.toHaveBeenCalled();
    expect(gmailCtor).not.toHaveBeenCalled();
    expect(logInfo).toHaveBeenCalledWith(
      expect.objectContaining({ to: "customer@example.com", live: false, mode: "mock" }),
      expect.any(String)
    );
  });
});
