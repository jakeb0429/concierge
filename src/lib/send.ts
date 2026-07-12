import { getChannelAdapter } from "./channels";
import { logger } from "./log";
import type { Channel } from "@prisma/client";

/**
 * Send a confirmed reply through the tenant's channel. Send is the ONLY outbound
 * action and only ever runs from a rep's confirm click.
 *
 * Phase-0 build: if the channel has no live credentials configured (e.g. the Rheos
 * Gmail service account isn't wired yet), we LOG instead of sending — exactly the
 * "send stubbed or logged" behavior the design calls for. The moment credentials
 * exist, the same call sends for real via the adapter, no code change.
 */
export async function sendReply(args: {
  channel: Channel;
  providerThreadId: string;
  inReplyToMessageId: string;
  to: string;
  html: string;
  subject: string;
}): Promise<{ providerMessageId: string; live: boolean }> {
  // Mock/seed tickets NEVER transmit, even with live send on — their addresses
  // are fabricated and could belong to real strangers.
  const isMock = args.providerThreadId.startsWith("mock-");
  // Safety gate: even with live credentials present, DO NOT transmit unless
  // CONCIERGE_LIVE_SEND is explicitly "true".
  const creds =
    !isMock && process.env.CONCIERGE_LIVE_SEND === "true" ? credentialsFor(args.channel.provider) : null;
  if (!creds) {
    logger.info(
      {
        to: args.to,
        live: false,
        mode: isMock ? "mock" : "stub",
        provider: args.channel.provider,
        from: args.channel.supportAddress,
        subject: args.subject,
      },
      "[send] logged instead of sending"
    );
    return { providerMessageId: `stub-${Date.now()}`, live: false };
  }

  // Pre-live MASTER guard: while EMAIL_REDIRECT_TO is set, reroute the customer
  // reply to that address instead of the real customer — so NO reply reaches a
  // customer before go-live even when CONCIERGE_LIVE_SEND is on. This mirrors
  // sendEmail's applyPreLiveRedirect so the one env var truly contains ALL
  // outbound (notifications AND customer replies). Clearing it is the go-live
  // switch. The real recipient is preserved in the subject.
  const redirect = process.env.EMAIL_REDIRECT_TO?.trim();
  const to = redirect || args.to;
  const subject = redirect ? `[pre-live → ${args.to}] ${args.subject}` : args.subject;

  const adapter = getChannelAdapter({
    tenantId: args.channel.tenantId,
    provider: args.channel.provider as "gmail" | "graph",
    supportAddress: args.channel.supportAddress,
    credentials: creds,
  });
  const res = await adapter.send({
    providerThreadId: args.providerThreadId,
    inReplyToMessageId: args.inReplyToMessageId,
    from: args.channel.supportAddress,
    to,
    subject,
    html: args.html,
  });
  logger.info(
    { to, intendedTo: args.to, redirected: !!redirect, live: true, provider: args.channel.provider, providerMessageId: res.providerMessageId },
    "[send] reply transmitted"
  );
  return { providerMessageId: res.providerMessageId, live: true };
}

/** Resolve provider credentials from env; null means "not wired — log instead". */
export function credentialsFor(provider: string): Record<string, string> | null {
  if (provider === "gmail" && process.env.RHEOS_GMAIL_CLIENT_EMAIL) {
    return {
      clientEmail: process.env.RHEOS_GMAIL_CLIENT_EMAIL,
      privateKey: process.env.RHEOS_GMAIL_PRIVATE_KEY ?? "",
      pubsubTopic: process.env.RHEOS_GMAIL_PUBSUB_TOPIC ?? "",
    };
  }
  if (provider === "graph" && process.env.STINGRAY_GRAPH_CLIENT_SECRET) {
    return {
      azureTenantId: process.env.STINGRAY_GRAPH_TENANT_ID ?? "",
      clientId: process.env.STINGRAY_GRAPH_CLIENT_ID ?? "",
      clientSecret: process.env.STINGRAY_GRAPH_CLIENT_SECRET,
    };
  }
  return null;
}
