import type {
  ChannelAdapter,
  ChannelConfig,
  IngestResult,
  OutboundReply,
} from "./types";

/**
 * GraphMailAdapter — Stingray (support@stingrayboats.com on Microsoft 365).
 *
 * This is the proof that Concierge is Microsoft-ready by design: it satisfies the
 * SAME ChannelAdapter interface as Gmail, so the core, data model, and UI already
 * support M365. Onboarding Stingray = (1) an Azure app registration with mailbox
 * permissions, (2) fill in the method bodies below against @microsoft/microsoft-graph-client,
 * (3) add a Channel row with provider="graph". No core changes.
 *
 * Provider mapping (mirrors Gmail, inverted where the concepts differ):
 *   tag     -> Outlook category   (POST /messages/{id}  { categories: [...] })
 *   folder  -> mailFolders move   (POST /messages/{id}/move { destinationId })
 *   archive -> move to Archive    (well-known folder "archive")
 *   ingest  -> GET /messages + delta; push via change subscriptions (webhook)
 *   send    -> POST /sendMail from the shared mailbox
 *
 * Intentionally NOT implemented yet — throwing keeps the seam honest until Stingray
 * onboards, while the types compile and prove the interface is provider-shaped.
 */
export class GraphMailAdapter implements ChannelAdapter {
  readonly provider = "graph" as const;
  readonly tenantId: string;
  private readonly cfg: ChannelConfig;

  constructor(cfg: ChannelConfig) {
    this.tenantId = cfg.tenantId;
    this.cfg = cfg;
  }

  private notYet(): never {
    throw new Error(
      "GraphMailAdapter is scaffolded for Stingray/M365 but not wired. " +
        "Provide an Azure app registration (Mail.ReadWrite, Mail.Send on the shared " +
        "mailbox) and implement against @microsoft/microsoft-graph-client."
    );
  }

  // Each method maps 1:1 to a documented Graph call; bodies land at Stingray onboarding.
  async ingest(_cursor: string | null): Promise<IngestResult> {
    // GET /users/{support}/mailFolders/inbox/messages/delta  (persist deltaLink as cursor)
    return this.notYet();
  }

  async send(_reply: OutboundReply): Promise<{ providerMessageId: string }> {
    // POST /users/{support}/sendMail
    return this.notYet();
  }

  async applyTag(_id: string, _tag: string): Promise<void> {
    // PATCH /messages/{id}  { categories: [...existing, tag] }
    return this.notYet();
  }

  async removeTag(_id: string, _tag: string): Promise<void> {
    // PATCH /messages/{id}  { categories: existing.filter(c => c !== tag) }
    return this.notYet();
  }

  async moveToFolder(_id: string, _folder: string): Promise<void> {
    // POST /messages/{id}/move  { destinationId: <mailFolder id> }
    return this.notYet();
  }

  async archive(_id: string): Promise<void> {
    // POST /messages/{id}/move  { destinationId: "archive" }
    return this.notYet();
  }

  async watch(): Promise<{ expiresAt: Date | null }> {
    // POST /subscriptions  { resource: ".../messages", changeType: "created", notificationUrl }
    return this.notYet();
  }
}
