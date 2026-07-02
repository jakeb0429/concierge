import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { syncArchiveToProvider } from "@/lib/archive";

/**
 * Bulk archive — Jake's noise-cleanup flow: multi-select vendor pitches /
 * automated mail and clear them in one click. Each ticket is archived in
 * Concierge AND (best-effort) in the real mailbox. Also works on tickets
 * already archived in Concierge whose Gmail thread still sits in INBOX.
 */
export async function POST(req: Request) {
  const tenant = await getCurrentTenant();
  const { ticketIds, action } = (await req.json()) as { ticketIds?: string[]; action?: string };
  if (action !== "archive" || !Array.isArray(ticketIds) || !ticketIds.length)
    return NextResponse.json({ error: "Expected { action: 'archive', ticketIds: [...] }." }, { status: 400 });
  if (ticketIds.length > 200)
    return NextResponse.json({ error: "Too many tickets in one call (max 200)." }, { status: 400 });

  const tickets = await prisma.ticket.findMany({
    where: { id: { in: ticketIds }, tenantId: tenant.id },
    select: { id: true, status: true },
  });

  let archived = 0;
  let providerArchived = 0;
  for (const t of tickets) {
    if (t.status !== "archived") {
      await prisma.ticket.update({ where: { id: t.id }, data: { status: "archived" } });
      archived++;
    }
    if (await syncArchiveToProvider(t.id)) providerArchived++;
  }
  await prisma.auditEvent.create({
    data: {
      tenantId: tenant.id,
      action: "tickets_bulk_archived",
      entity: `tickets:${tickets.length}`,
      meta: { ticketIds: tickets.map((t) => t.id), archived, providerArchived },
    },
  });
  return NextResponse.json({ ok: true, requested: ticketIds.length, archived, providerArchived });
}
