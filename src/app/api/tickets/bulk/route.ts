import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { syncArchiveToProvider } from "@/lib/archive";
import { parseBody } from "@/lib/validate";

// max(200) caps the per-call provider-archive fan-out (one Gmail call each).
const bodySchema = z.object({
  action: z.literal("archive"),
  ticketIds: z.array(z.string()).min(1).max(200),
});

/**
 * Bulk archive — Jake's noise-cleanup flow: multi-select vendor pitches /
 * automated mail and clear them in one click. Each ticket is archived in
 * Concierge AND (best-effort) in the real mailbox. Also works on tickets
 * already archived in Concierge whose Gmail thread still sits in INBOX.
 */
export async function POST(req: Request) {
  const tenant = await getCurrentTenant();
  const parsed = await parseBody(req, bodySchema);
  if (parsed instanceof NextResponse) return parsed;
  const { ticketIds } = parsed;

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
