import { prisma } from "./db";
import { getChannelAdapter } from "./channels";
import { credentialsFor } from "./send";
import { logger } from "./log";

/**
 * Two-way archive sync, Concierge→mailbox direction: archiving a ticket in
 * Concierge also archives the thread in the real mailbox (Gmail: INBOX label
 * dropped on the whole thread), and restoring a ticket puts the thread back.
 * Best-effort — a provider failure never blocks the Concierge-side change.
 * Guards mirror send.ts: mock/seed tickets and unwired providers are skipped.
 * (The mailbox→Concierge direction lives in the intake cron; see
 * src/lib/external-archive.ts.)
 */
async function syncToProvider(ticketId: string, op: "archive" | "unarchive"): Promise<boolean> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { channelRef: true },
  });
  if (!ticket?.channelRef) return false;
  if (ticket.providerThreadId.startsWith("mock-")) return false;

  const creds = credentialsFor(ticket.channelRef.provider);
  if (!creds) return false;

  try {
    const adapter = getChannelAdapter({
      tenantId: ticket.tenantId,
      provider: ticket.channelRef.provider as "gmail" | "graph",
      supportAddress: ticket.channelRef.supportAddress,
      credentials: creds,
    });
    if (op === "archive") await adapter.archiveThread(ticket.providerThreadId);
    else await adapter.unarchiveThread(ticket.providerThreadId);
    await prisma.auditEvent.create({
      data: {
        tenantId: ticket.tenantId,
        action: op === "archive" ? "provider_archived" : "provider_unarchived",
        entity: `ticket:${ticket.id}`,
        meta: { providerThreadId: ticket.providerThreadId, mailbox: ticket.channelRef.supportAddress },
      },
    });
    return true;
  } catch (e) {
    logger.error(
      { err: e, ticketId, provider: ticket.channelRef.provider, op },
      "[archive-sync] provider sync failed"
    );
    return false;
  }
}

export async function syncArchiveToProvider(ticketId: string): Promise<boolean> {
  return syncToProvider(ticketId, "archive");
}

export async function syncUnarchiveToProvider(ticketId: string): Promise<boolean> {
  return syncToProvider(ticketId, "unarchive");
}
