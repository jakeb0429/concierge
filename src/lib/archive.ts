import { prisma } from "./db";
import { getChannelAdapter } from "./channels";
import { credentialsFor } from "./send";

/**
 * Two-way archive sync: archiving a ticket in Concierge also archives the
 * thread in the real mailbox (Gmail: INBOX label dropped on the whole thread).
 * Best-effort — a provider failure never blocks the Concierge-side archive.
 * Guards mirror send.ts: mock/seed tickets and unwired providers are skipped.
 */
export async function syncArchiveToProvider(ticketId: string): Promise<boolean> {
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
    await adapter.archiveThread(ticket.providerThreadId);
    await prisma.auditEvent.create({
      data: {
        tenantId: ticket.tenantId,
        action: "provider_archived",
        entity: `ticket:${ticket.id}`,
        meta: { providerThreadId: ticket.providerThreadId, mailbox: ticket.channelRef.supportAddress },
      },
    });
    return true;
  } catch (e) {
    console.error(`[archive-sync] ticket ${ticketId} failed:`, (e as Error).message.slice(0, 120));
    return false;
  }
}
