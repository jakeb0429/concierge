import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GraphMailAdapter, graphBodyText, type GraphMessage } from "@/lib/channels/graph";

// unique clientId per test — the adapter's token cache is module-level and
// keyed by clientId, so reuse would swallow the mocked token-mint call
let cfgSeq = 0;
const freshCfg = () => ({
  tenantId: "t-sting",
  provider: "graph" as const,
  supportAddress: "hello@stingrayboats.com",
  credentials: { azureTenantId: "az-t", clientId: `az-c-${++cfgSeq}`, clientSecret: "az-s" },
});

function msg(overrides: Partial<GraphMessage> = {}): GraphMessage {
  return {
    id: "m1",
    conversationId: "conv1",
    subject: "Prop question",
    from: { emailAddress: { address: "Buyer@Example.com", name: "Boat Buyer" } },
    toRecipients: [{ emailAddress: { address: "hello@stingrayboats.com", name: "Stingray" } }],
    receivedDateTime: "2026-07-09T12:00:00Z",
    sentDateTime: null,
    body: { contentType: "html", content: "<p>Which prop fits the <b>192SC</b>?</p>" },
    bodyPreview: "Which prop fits",
    categories: [],
    hasAttachments: false,
    ...overrides,
  };
}

/** fetch mock: first call = token mint, then Graph calls in sequence. */
function mockFetchSequence(responses: { status?: number; json: unknown }[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let i = -1;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    i++;
    const r = responses[Math.min(i, responses.length - 1)];
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      json: async () => r.json,
      text: async () => JSON.stringify(r.json),
    } as Response;
  }));
  return calls;
}

const TOKEN = { json: { access_token: "tok", expires_in: 3600 } };

beforeEach(() => vi.useFakeTimers({ now: new Date(2026, 6, 9) }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("graphBodyText", () => {
  it("strips tags and entities from HTML bodies", () => {
    const text = graphBodyText({
      body: { contentType: "HTML", content: "<div>Hi &amp; hello<br>there<style>p{}</style></div>" },
      bodyPreview: null,
    });
    expect(text).toBe("Hi & hello\nthere");
  });

  it("passes text bodies through and falls back to the preview", () => {
    expect(graphBodyText({ body: { contentType: "text", content: "plain" }, bodyPreview: null })).toBe("plain");
    expect(graphBodyText({ body: null, bodyPreview: "preview" })).toBe("preview");
  });
});

describe("GraphMailAdapter.ingest", () => {
  it("normalizes messages with direction from the support address", async () => {
    mockFetchSequence([TOKEN, { json: { value: [msg(), msg({ id: "m2", from: { emailAddress: { address: "HELLO@stingrayboats.com", name: "Us" } } })] } }]);
    const got = await new GraphMailAdapter(freshCfg()).ingest(null);
    expect(got.messages).toHaveLength(2);
    expect(got.messages[0]).toMatchObject({
      providerMessageId: "m1",
      providerThreadId: "conv1",
      direction: "inbound",
      from: { email: "buyer@example.com", displayName: "Boat Buyer" },
      subject: "Prop question",
    });
    expect(got.messages[0].text).toContain("192SC");
    // our own message, case-insensitive match on the mailbox → outbound
    expect(got.messages[1].direction).toBe("outbound");
  });
});

describe("GraphMailAdapter.send", () => {
  it("replies inside the conversation: createReply → patch body/recipient → send", async () => {
    const calls = mockFetchSequence([
      TOKEN,
      { json: { id: "draft1" } }, // createReply
      { json: {} }, // PATCH
      { status: 202, json: {} }, // send
    ]);
    const got = await new GraphMailAdapter(freshCfg()).send({
      providerThreadId: "conv1",
      inReplyToMessageId: "m1",
      from: "hello@stingrayboats.com",
      to: "buyer@example.com",
      subject: "Re: Prop question",
      html: "<p>The 192SC takes…</p>",
    });
    expect(got.providerMessageId).toBe("draft1");
    expect(calls[1].url).toContain("/messages/m1/createReply");
    const patch = JSON.parse(String(calls[2].init?.body));
    expect(patch.toRecipients[0].emailAddress.address).toBe("buyer@example.com");
    expect(patch.body.content).toContain("192SC");
    expect(calls[3].url).toContain("/messages/draft1/send");
  });

  it("falls back to a fresh sendMail when the original message is unknown", async () => {
    const calls = mockFetchSequence([
      TOKEN,
      { status: 404, json: { error: { code: "ErrorItemNotFound" } } }, // createReply fails
      { status: 202, json: {} }, // sendMail
    ]);
    const got = await new GraphMailAdapter(freshCfg()).send({
      providerThreadId: "conv-x",
      inReplyToMessageId: "gone",
      from: "hello@stingrayboats.com",
      to: "buyer@example.com",
      subject: "Re: hi",
      html: "<p>hi</p>",
    });
    expect(got.providerMessageId).toMatch(/^graph-sent-/);
    expect(calls[2].url).toContain("/sendMail");
    const body = JSON.parse(String(calls[2].init?.body));
    expect(body.saveToSentItems).toBe(true);
  });

  it("throws when credentials are missing — a send failure must surface", async () => {
    const adapter = new GraphMailAdapter({ ...freshCfg(), credentials: {} });
    await expect(
      adapter.send({ providerThreadId: "c", inReplyToMessageId: "", from: "a", to: "b", subject: "s", html: "h" })
    ).rejects.toThrow(/credentials/i);
  });
});

describe("GraphMailAdapter tags", () => {
  it("applyTag merges with existing categories without duplicating", async () => {
    const calls = mockFetchSequence([TOKEN, { json: { categories: ["warranty"] } }, { json: {} }]);
    await new GraphMailAdapter(freshCfg()).applyTag("m1", "returns_exchange");
    const patch = JSON.parse(String(calls[2].init?.body));
    expect(patch.categories).toEqual(["warranty", "returns_exchange"]);
  });
});

describe("credentialsFor(graph)", () => {
  it("resolves the STINGRAY_GRAPH_* env vars, null when unset", async () => {
    const { credentialsFor } = await import("@/lib/send");
    vi.stubEnv("STINGRAY_GRAPH_TENANT_ID", "az-t");
    vi.stubEnv("STINGRAY_GRAPH_CLIENT_ID", "az-c");
    vi.stubEnv("STINGRAY_GRAPH_CLIENT_SECRET", "az-s");
    expect(credentialsFor("graph")).toEqual({ azureTenantId: "az-t", clientId: "az-c", clientSecret: "az-s" });
    vi.stubEnv("STINGRAY_GRAPH_CLIENT_SECRET", "");
    expect(credentialsFor("graph")).toBeNull();
  });
});
