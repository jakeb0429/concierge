import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { sessionUser } from "@/lib/roles";
import { syncUnarchiveToProvider } from "@/lib/archive";
import { GMAIL_ARCHIVED_TAG, MISSED_ARCHIVE_TAG } from "@/lib/external-archive";
import { parseBody } from "@/lib/validate";

const bodySchema = z.object({ action: z.enum(["restore", "dismiss"]) });

/**
 * Resolve a "did you miss this?" warning (a thread archived in Gmail while
 * the ticket still looked like live work):
 *   restore — reopen the ticket AND put the thread back in the Gmail inbox
 *   dismiss — the archive was intentional; clear the warning, stay archived
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await getCurrentTenant();
  const body = await parseBody(req, bodySchema);
  if (body instanceof NextResponse) return body;

  const ticket = await prisma.ticket.findFirst({ where: { id, tenantId: tenant.id } });
  if (!ticket) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!ticket.tags.includes(MISSED_ARCHIVE_TAG))
    return NextResponse.json({ error: "Ticket is not flagged." }, { status: 400 });

  const actor = await sessionUser();
  const restore = body.action === "restore";
  // Dismiss keeps the gmail_archived provenance; restore clears both marks.
  const tags = ticket.tags.filter((t) => t !== MISSED_ARCHIVE_TAG && (!restore || t !== GMAIL_ARCHIVED_TAG));
  await prisma.ticket.update({
    where: { id },
    data: restore ? { status: "new", tags } : { tags },
  });
  const providerRestored = restore ? await syncUnarchiveToProvider(id) : false;
  await prisma.auditEvent.create({
    data: {
      tenantId: tenant.id,
      actorId: actor?.id,
      action: restore ? "ticket_missed_restored" : "ticket_missed_dismissed",
      entity: `ticket:${id}`,
      meta: { providerRestored },
    },
  });
  return NextResponse.json({ ok: true, action: body.action, providerRestored });
}
