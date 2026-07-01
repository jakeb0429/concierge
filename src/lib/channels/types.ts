/**
 * ChannelAdapter — the provider-agnostic seam.
 *
 * The Concierge core NEVER imports googleapis or @microsoft/microsoft-graph-client
 * directly. It only ever talks to this interface. Gmail (Rheos / Google Workspace)
 * and Microsoft Graph (Stingray / M365) are two implementations of it.
 *
 * Every provider difference collapses to the same handful of operations:
 *
 *   concept   | Gmail                         | Microsoft Graph
 *   ----------|-------------------------------|-------------------------------
 *   ingest    | messages.list + watch (PubSub)| messages + change subscriptions
 *   send      | send-as / DWD                 | sendMail (shared mailbox perms)
 *   tag       | Label                         | Category
 *   folder    | Label move                    | mailFolders move
 *   archive   | remove INBOX label            | move to Archive folder
 *
 * Adding a Microsoft tenant = implement GraphMailAdapter (already stubbed) + an
 * Azure app registration. Zero changes to the core, the data model, or the UI.
 */

/** A person on the other end of a thread, normalized across providers. */
export interface NormalizedContact {
  email: string | null;
  handle: string | null; // social handle when the channel is not email
  displayName: string | null;
}

/** One inbound or outbound message, normalized from whatever the provider returned. */
export interface NormalizedMessage {
  providerMessageId: string;
  providerThreadId: string;
  from: NormalizedContact;
  to: NormalizedContact[];
  subject: string | null;
  /** Plain-text body used for classification/retrieval. */
  text: string;
  /** Original HTML body when present (rendered in the UI). */
  html: string | null;
  direction: "inbound" | "outbound";
  sentAt: Date;
  providerLabels: string[]; // Gmail labelIds / Graph categories, as-is
}

/** A reply the rep has confirmed. `from` is the shared support address. */
export interface OutboundReply {
  providerThreadId: string;
  inReplyToMessageId: string;
  from: string; // e.g. hello@rheosgear.com or support@stingrayboats.com
  to: string; // the customer being replied to — always explicit, always shown to the rep
  subject: string;
  html: string;
}

/** Result of listing new mail since the last sync cursor. */
export interface IngestResult {
  messages: NormalizedMessage[];
  /** Opaque provider cursor (Gmail historyId / Graph deltaLink) to persist. */
  nextCursor: string | null;
}

/**
 * The single interface the core depends on. Implemented once per provider.
 * Tag/folder/archive are the two-way-sync operations (Section 7 of the design):
 * organizing a ticket in Concierge reflects into the real mailbox.
 */
export interface ChannelAdapter {
  readonly provider: "gmail" | "graph";
  readonly tenantId: string;

  /** Pull new messages since `cursor` (null = initial backfill window). */
  ingest(cursor: string | null): Promise<IngestResult>;

  /** Send a rep-confirmed reply. The ONLY outbound action in the system. */
  send(reply: OutboundReply): Promise<{ providerMessageId: string }>;

  /** Apply/remove a tag (Gmail label ↔ Outlook category). */
  applyTag(providerMessageId: string, tag: string): Promise<void>;
  removeTag(providerMessageId: string, tag: string): Promise<void>;

  /** Move a message to a folder mirroring a Concierge folder. */
  moveToFolder(providerMessageId: string, folder: string): Promise<void>;

  /** Archive (Gmail: drop INBOX label; Graph: move to Archive folder). */
  archive(providerMessageId: string): Promise<void>;

  /** Register push notifications so intake is near-real-time, not polled. */
  watch(): Promise<{ expiresAt: Date | null }>;
}

/** How a tenant's mailbox is configured. Persisted per Channel row. */
export interface ChannelConfig {
  tenantId: string;
  provider: "gmail" | "graph";
  supportAddress: string;
  /** Provider-specific secrets resolved at runtime (never stored in code). */
  credentials: Record<string, string>;
}
