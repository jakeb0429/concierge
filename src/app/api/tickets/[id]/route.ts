import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { syncArchiveToProvider } from "@/lib/archive";

const ALLOWED = new Set(["new", "in_review", "resolved", "archived"]);

/** Rep ticket actions: archive / resolve / reopen. Archiving also archives the
 *  thread in the real mailbox (best-effort). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await getCurrentTenant();
  const { status } = (await req.json()) as { status: string };
  if (!ALLOWED.has(status)) return NextResponse.json({ error: "Invalid status." }, { status: 400 });

  const ticket = await prisma.ticket.findFirst({ where: { id, tenantId: tenant.id } });
  if (!ticket) return NextResponse.json({ error: "Not found." }, { status: 404 });

  await prisma.ticket.update({ where: { id }, data: { status } });
  await prisma.auditEvent.create({
    data: { tenantId: tenant.id, action: `ticket_${status}`, entity: `ticket:${id}` },
  });
  const providerArchived = status === "archived" ? await syncArchiveToProvider(id) : false;
  return NextResponse.json({ ok: true, status, providerArchived });
}
