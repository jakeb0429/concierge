import { getChannelAdapter } from "./channels";
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
  html: string;
  subject: string;
}): Promise<{ providerMessageId: string; live: boolean }> {
  // Safety gate: even with live credentials present, DO NOT transmit unless
  // CONCIERGE_LIVE_SEND is explicitly "true". This prevents an accidental real
  // email to a mock/test recipient while we're still working against seed data.
  const creds = process.env.CONCIERGE_LIVE_SEND === "true" ? credentialsFor(args.channel.provider) : null;
  if (!creds) {
    console.log(
      `[send:stub] would send via ${args.channel.provider} from ${args.channel.supportAddress} — "${args.subject}"`
    );
    return { providerMessageId: `stub-${Date.now()}`, live: false };
  }

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
    subject: args.subject,
    html: args.html,
  });
  return { providerMessageId: res.providerMessageId, live: true };
}

/** Resolve provider credentials from env; null means "not wired — log instead". */
function credentialsFor(provider: string): Record<string, string> | null {
  if (provider === "gmail" && process.env.RHEOS_GMAIL_CLIENT_EMAIL) {
    return {
      clientEmail: process.env.RHEOS_GMAIL_CLIENT_EMAIL,
      privateKey: process.env.RHEOS_GMAIL_PRIVATE_KEY ?? "",
      pubsubTopic: process.env.RHEOS_GMAIL_PUBSUB_TOPIC ?? "",
    };
  }
  return null;
}
