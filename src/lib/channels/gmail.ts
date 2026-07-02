import { google, gmail_v1 } from "googleapis";
import type {
  ChannelAdapter,
  ChannelConfig,
  IngestResult,
  NormalizedMessage,
  OutboundReply,
} from "./types";

/**
 * GmailAdapter — Rheos (hello@rheosgear.com on Google Workspace).
 *
 * Auth: a Google Cloud service account with domain-wide delegation, impersonating
 * the shared support mailbox. Credentials come from ChannelConfig, never from code.
 *
 * Provider mapping (see types.ts):
 *   tag     -> Gmail label
 *   folder  -> Gmail label (Gmail has no folders; a "folder" is a label move)
 *   archive -> remove the INBOX label
 */
export class GmailAdapter implements ChannelAdapter {
  readonly provider = "gmail" as const;
  readonly tenantId: string;
  private readonly supportAddress: string;
  private readonly cfg: ChannelConfig;

  constructor(cfg: ChannelConfig) {
    this.tenantId = cfg.tenantId;
    this.supportAddress = cfg.supportAddress;
    this.cfg = cfg;
  }

  private async client(): Promise<gmail_v1.Gmail> {
    const auth = new google.auth.JWT({
      email: this.cfg.credentials.clientEmail,
      key: this.cfg.credentials.privateKey.replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/gmail.modify"],
      subject: this.supportAddress, // impersonate the shared mailbox
    });
    return google.gmail({ version: "v1", auth });
  }

  async ingest(cursor: string | null): Promise<IngestResult> {
    const gmail = await this.client();
    // Incremental via history when we have a cursor; initial window otherwise.
    const messages: NormalizedMessage[] = [];
    const list = await gmail.users.messages.list({
      userId: "me",
      q: cursor ? undefined : "newer_than:30d",
      labelIds: ["INBOX"],
      maxResults: 50,
    });
    for (const ref of list.data.messages ?? []) {
      const full = await gmail.users.messages.get({ userId: "me", id: ref.id!, format: "full" });
      messages.push(this.normalize(full.data));
    }
    const profile = await gmail.users.getProfile({ userId: "me" });
    return { messages, nextCursor: String(profile.data.historyId ?? "") || null };
  }

  async send(reply: OutboundReply): Promise<{ providerMessageId: string }> {
    const gmail = await this.client();

    // Resolve the RFC Message-ID of the message we're replying to, so the reply
    // threads correctly in the CUSTOMER's mail client (Gmail's threadId only
    // threads it on our side). inReplyToMessageId is Gmail's internal id.
    let rfcMessageId: string | null = null;
    let references: string | null = null;
    if (reply.inReplyToMessageId) {
      try {
        const orig = await gmail.users.messages.get({
          userId: "me",
          id: reply.inReplyToMessageId,
          format: "metadata",
          metadataHeaders: ["Message-ID", "References"],
        });
        const h = (n: string) =>
          orig.data.payload?.headers?.find((x) => x.name?.toLowerCase() === n.toLowerCase())?.value ?? null;
        rfcMessageId = h("Message-ID");
        references = [h("References"), rfcMessageId].filter(Boolean).join(" ") || null;
      } catch {
        /* threading headers are best-effort; send still goes out addressed */
      }
    }

    const headers = [
      `From: ${reply.from}`,
      `To: ${reply.to}`,
      `Subject: ${reply.subject}`,
      ...(rfcMessageId ? [`In-Reply-To: ${rfcMessageId}`] : []),
      ...(references ? [`References: ${references}`] : []),
      "Content-Type: text/html; charset=UTF-8",
      "MIME-Version: 1.0",
    ];
    const raw = Buffer.from([...headers, "", reply.html].join("\r\n"))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    try {
      const sent = await gmail.users.messages.send({
        userId: "me",
        requestBody: { raw, threadId: reply.providerThreadId },
      });
      return { providerMessageId: sent.data.id! };
    } catch (e) {
      // Tickets that didn't originate in Gmail (web form, pasted note, tests)
      // carry a thread id Gmail doesn't recognize — send as a new thread.
      if (String(e).includes("Invalid thread_id")) {
        const sent = await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
        return { providerMessageId: sent.data.id! };
      }
      throw e;
    }
  }

  async applyTag(id: string, tag: string): Promise<void> {
    const gmail = await this.client();
    const labelId = await this.ensureLabel(gmail, tag);
    await gmail.users.messages.modify({ userId: "me", id, requestBody: { addLabelIds: [labelId] } });
  }

  async removeTag(id: string, tag: string): Promise<void> {
    const gmail = await this.client();
    const labelId = await this.ensureLabel(gmail, tag);
    await gmail.users.messages.modify({ userId: "me", id, requestBody: { removeLabelIds: [labelId] } });
  }

  async moveToFolder(id: string, folder: string): Promise<void> {
    // Gmail models folders as labels; a move = add the folder label, drop INBOX.
    const gmail = await this.client();
    const labelId = await this.ensureLabel(gmail, folder);
    await gmail.users.messages.modify({
      userId: "me",
      id,
      requestBody: { addLabelIds: [labelId], removeLabelIds: ["INBOX"] },
    });
  }

  async archive(id: string): Promise<void> {
    const gmail = await this.client();
    await gmail.users.messages.modify({ userId: "me", id, requestBody: { removeLabelIds: ["INBOX"] } });
  }

  async archiveThread(threadId: string): Promise<void> {
    const gmail = await this.client();
    await gmail.users.threads.modify({ userId: "me", id: threadId, requestBody: { removeLabelIds: ["INBOX"] } });
  }

  async watch(): Promise<{ expiresAt: Date | null }> {
    const gmail = await this.client();
    const res = await gmail.users.watch({
      userId: "me",
      requestBody: { topicName: this.cfg.credentials.pubsubTopic, labelIds: ["INBOX"] },
    });
    return { expiresAt: res.data.expiration ? new Date(Number(res.data.expiration)) : null };
  }

  // --- helpers -------------------------------------------------------------

  private async ensureLabel(gmail: gmail_v1.Gmail, name: string): Promise<string> {
    const existing = await gmail.users.labels.list({ userId: "me" });
    const found = existing.data.labels?.find((l) => l.name === name);
    if (found?.id) return found.id;
    const created = await gmail.users.labels.create({ userId: "me", requestBody: { name } });
    return created.data.id!;
  }

  private normalize(m: gmail_v1.Schema$Message): NormalizedMessage {
    const headers = m.payload?.headers ?? [];
    const h = (n: string) => headers.find((x) => x.name?.toLowerCase() === n)?.value ?? null;
    const parseAddr = (v: string | null) => {
      if (!v) return { email: null, handle: null, displayName: null };
      const match = v.match(/(.*)<(.+)>/);
      return match
        ? { displayName: match[1].trim().replace(/"/g, ""), email: match[2].trim(), handle: null }
        : { displayName: null, email: v.trim(), handle: null };
    };
    const from = parseAddr(h("from"));
    const isInbound = from.email !== this.supportAddress;
    return {
      providerMessageId: m.id!,
      providerThreadId: m.threadId!,
      from,
      to: [parseAddr(h("to"))],
      subject: h("subject"),
      text: decodeBody(m.payload) ?? m.snippet ?? "",
      html: decodeBody(m.payload, "text/html"),
      direction: isInbound ? "inbound" : "outbound",
      sentAt: new Date(Number(m.internalDate ?? Date.now())),
      providerLabels: m.labelIds ?? [],
    };
  }
}

function decodeBody(part: gmail_v1.Schema$MessagePart | undefined, mime = "text/plain"): string | null {
  if (!part) return null;
  if (part.mimeType === mime && part.body?.data) {
    return Buffer.from(part.body.data, "base64").toString("utf-8");
  }
  for (const p of part.parts ?? []) {
    const found = decodeBody(p, mime);
    if (found) return found;
  }
  return null;
}
