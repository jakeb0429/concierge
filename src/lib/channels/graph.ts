import type {
  ChannelAdapter,
  ChannelConfig,
  IngestResult,
  NormalizedMessage,
  OutboundReply,
} from "./types";

/**
 * GraphMailAdapter — Stingray (hello@stingrayboats.com on Microsoft 365).
 *
 * Auth: Azure app registration (client-credentials flow) with application
 * permissions Mail.ReadWrite + Mail.Send, scoped to the support mailbox via
 * an ApplicationAccessPolicy on the M365 side. Credentials come from
 * ChannelConfig (tenantId/clientId/clientSecret), never from code.
 *
 * Implemented with bounded plain fetch — no SDK dependency. Every call
 * carries a timeout; mutations are never fail-soft (a failed send/tag must
 * surface, not vanish).
 *
 * Provider mapping (mirrors Gmail, inverted where the concepts differ):
 *   tag     -> Outlook category   (PATCH /messages/{id} { categories })
 *   folder  -> mailFolders move   (POST /messages/{id}/move { destinationId })
 *   archive -> move to Archive    (well-known folder "archive")
 *   thread  -> conversationId     (Graph has no thread ops; act per message)
 *   send    -> createReply + send (preserves Outlook conversation threading)
 */

const GRAPH = "https://graph.microsoft.com/v1.0";
const TIMEOUT = 15_000;

/** App-only token, cached until 5 minutes before expiry (single PM2 process). */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export class GraphMailAdapter implements ChannelAdapter {
  readonly provider = "graph" as const;
  readonly tenantId: string;
  private readonly supportAddress: string;
  private readonly cfg: ChannelConfig;

  constructor(cfg: ChannelConfig) {
    this.tenantId = cfg.tenantId;
    this.supportAddress = cfg.supportAddress;
    this.cfg = cfg;
  }

  private async token(): Promise<string> {
    const { azureTenantId, clientId, clientSecret } = this.cfg.credentials;
    if (!azureTenantId || !clientId || !clientSecret) {
      throw new Error("GraphMailAdapter: missing STINGRAY_GRAPH_* credentials.");
    }
    const cached = tokenCache.get(clientId);
    if (cached && cached.expiresAt > Date.now() + 300_000) return cached.token;
    const res = await fetch(`https://login.microsoftonline.com/${azureTenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
      }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) throw new Error(`Graph token mint failed: ${res.status} ${await res.text()}`);
    const d = (await res.json()) as { access_token: string; expires_in: number };
    tokenCache.set(clientId, { token: d.access_token, expiresAt: Date.now() + d.expires_in * 1000 });
    return d.access_token;
  }

  /**
   * Bounded Graph call against the support mailbox. Throws on failure.
   * Public so the intake cron can page messages through the same cached
   * token without re-minting per call.
   */
  async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.g<T>(method, path, body);
  }

  private async g<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${GRAPH}/users/${encodeURIComponent(this.supportAddress)}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) throw new Error(`Graph ${method} ${path} failed: ${res.status} ${await res.text()}`);
    if (res.status === 204 || res.status === 202) return undefined as T;
    return (await res.json()) as T;
  }

  async ingest(cursor: string | null): Promise<IngestResult> {
    // Recent-inbox poll, same shape as the Gmail intake. Delta sync can layer
    // on later; the cron's upserts are idempotent so overlap is harmless.
    const window = cursor ? "" : ""; // window filtering handled by $top ordering
    void window;
    const list = await this.g<{ value: GraphMessage[] }>(
      "GET",
      `/mailFolders/inbox/messages?$top=50&$orderby=receivedDateTime desc&$select=${MSG_SELECT}`
    );
    return { messages: (list.value ?? []).map((m) => this.normalize(m)), nextCursor: null };
  }

  async send(reply: OutboundReply): Promise<{ providerMessageId: string }> {
    // Reply INSIDE the Outlook conversation when we know the original message:
    // createReply drafts carry the threading headers; we overwrite body + To.
    if (reply.inReplyToMessageId && !reply.inReplyToMessageId.startsWith("stub-")) {
      try {
        const draft = await this.g<{ id: string }>(
          "POST",
          `/messages/${encodeURIComponent(reply.inReplyToMessageId)}/createReply`
        );
        await this.g("PATCH", `/messages/${draft.id}`, {
          body: { contentType: "HTML", content: reply.html },
          toRecipients: [{ emailAddress: { address: reply.to } }],
          subject: reply.subject,
        });
        await this.g("POST", `/messages/${draft.id}/send`);
        return { providerMessageId: draft.id };
      } catch {
        // Original message unknown to Graph (imported/legacy) — fall through
        // to a fresh sendMail below rather than losing the rep's reply.
      }
    }
    await this.g("POST", `/sendMail`, {
      message: {
        subject: reply.subject,
        body: { contentType: "HTML", content: reply.html },
        toRecipients: [{ emailAddress: { address: reply.to } }],
      },
      saveToSentItems: true,
    });
    // sendMail returns 202 with no id; stamp a synthetic id (unique per send).
    return { providerMessageId: `graph-sent-${Date.now()}` };
  }

  async applyTag(id: string, tag: string): Promise<void> {
    const msg = await this.g<{ categories: string[] }>("GET", `/messages/${encodeURIComponent(id)}?$select=categories`);
    const categories = [...new Set([...(msg.categories ?? []), tag])];
    await this.g("PATCH", `/messages/${encodeURIComponent(id)}`, { categories });
  }

  async removeTag(id: string, tag: string): Promise<void> {
    const msg = await this.g<{ categories: string[] }>("GET", `/messages/${encodeURIComponent(id)}?$select=categories`);
    await this.g("PATCH", `/messages/${encodeURIComponent(id)}`, {
      categories: (msg.categories ?? []).filter((c) => c !== tag),
    });
  }

  async moveToFolder(id: string, folder: string): Promise<void> {
    const dest = await this.ensureFolder(folder);
    await this.g("POST", `/messages/${encodeURIComponent(id)}/move`, { destinationId: dest });
  }

  async archive(id: string): Promise<void> {
    // "archive" is a Graph well-known folder name, valid as destinationId.
    await this.g("POST", `/messages/${encodeURIComponent(id)}/move`, { destinationId: "archive" });
  }

  async archiveThread(threadId: string): Promise<void> {
    // Graph has no thread-level ops — archive each inbox message in the conversation.
    const list = await this.g<{ value: { id: string }[] }>(
      "GET",
      `/mailFolders/inbox/messages?$filter=conversationId eq '${threadId.replace(/'/g, "''")}'&$top=50&$select=id`
    );
    for (const m of list.value ?? []) await this.archive(m.id);
  }

  async watch(): Promise<{ expiresAt: Date | null }> {
    // Push subscriptions need a public notification webhook (with HMAC
    // validation) — intake is cron-polled for the pilot, same as Gmail.
    throw new Error("Graph push subscriptions not configured — intake runs on the polling cron.");
  }

  // --- helpers -------------------------------------------------------------

  private async ensureFolder(name: string): Promise<string> {
    const found = await this.g<{ value: { id: string; displayName: string }[] }>(
      "GET",
      `/mailFolders?$filter=displayName eq '${name.replace(/'/g, "''")}'&$top=1`
    );
    if (found.value?.[0]?.id) return found.value[0].id;
    const created = await this.g<{ id: string }>("POST", `/mailFolders`, { displayName: name });
    return created.id;
  }

  private normalize(m: GraphMessage): NormalizedMessage {
    const fromEmail = m.from?.emailAddress?.address?.toLowerCase() ?? null;
    const isInbound = fromEmail !== this.supportAddress.toLowerCase();
    return {
      providerMessageId: m.id,
      providerThreadId: m.conversationId,
      from: {
        email: fromEmail,
        handle: null,
        displayName: m.from?.emailAddress?.name ?? null,
      },
      to: (m.toRecipients ?? []).map((r) => ({
        email: r.emailAddress?.address?.toLowerCase() ?? null,
        handle: null,
        displayName: r.emailAddress?.name ?? null,
      })),
      subject: m.subject ?? null,
      text: graphBodyText(m),
      html: m.body?.contentType?.toLowerCase() === "html" ? m.body.content : null,
      direction: isInbound ? "inbound" : "outbound",
      sentAt: new Date(m.receivedDateTime ?? m.sentDateTime ?? Date.now()),
      providerLabels: m.categories ?? [],
    };
  }
}

export const MSG_SELECT =
  "id,conversationId,subject,from,toRecipients,receivedDateTime,sentDateTime,body,bodyPreview,categories,hasAttachments";

export type GraphMessage = {
  id: string;
  conversationId: string;
  subject: string | null;
  from: { emailAddress: { address: string | null; name: string | null } } | null;
  toRecipients: { emailAddress: { address: string | null; name: string | null } }[] | null;
  receivedDateTime: string | null;
  sentDateTime: string | null;
  body: { contentType: string; content: string } | null;
  bodyPreview: string | null;
  categories: string[] | null;
  hasAttachments: boolean | null;
};

/** Plain text for classification: strip tags/entities when the body is HTML. */
export function graphBodyText(m: Pick<GraphMessage, "body" | "bodyPreview">): string {
  const body = m.body;
  if (!body?.content) return m.bodyPreview ?? "";
  if (body.contentType?.toLowerCase() === "text") return body.content;
  return body.content
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
