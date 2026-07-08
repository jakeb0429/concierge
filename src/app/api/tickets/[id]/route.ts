import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { sessionUser } from "@/lib/roles";
import { syncArchiveToProvider } from "@/lib/archive";
import { INQUIRY_CATEGORIES } from "@/lib/triage";

const ALLOWED = new Set(["new", "in_review", "resolved", "archived"]);

/** Rep ticket actions: archive / resolve / reopen, reassign, recategorize.
 *  Archiving also archives the thread in the real mailbox (best-effort). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await getCurrentTenant();
  const body = (await req.json()) as { status?: string; assigneeId?: string | null; category?: string };

  const ticket = await prisma.ticket.findFirst({ where: { id, tenantId: tenant.id } });
  if (!ticket) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const actor = await sessionUser();
  const data: { status?: string; assigneeId?: string | null; category?: string } = {};

  if (body.status !== undefined) {
    if (!ALLOWED.has(body.status)) return NextResponse.json({ error: "Invalid status." }, { status: 400 });
    data.status = body.status;
  }
  if (body.assigneeId !== undefined) {
    if (body.assigneeId !== null) {
      const assignee = await prisma.user.findFirst({ where: { id: body.assigneeId, tenantId: tenant.id } });
      if (!assignee) return NextResponse.json({ error: "Unknown assignee." }, { status: 400 });
    }
    data.assigneeId = body.assigneeId;
  }
  if (body.category !== undefined) {
    if (!(INQUIRY_CATEGORIES as readonly string[]).includes(body.category))
      return NextResponse.json({ error: "Invalid category." }, { status: 400 });
    data.category = body.category;
  }
  if (Object.keys(data).length === 0)
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  await prisma.ticket.update({ where: { id }, data });

  const action =
    data.status !== undefined
      ? `ticket_${data.status}`
      : data.assigneeId !== undefined
        ? "ticket_reassigned"
        : "ticket_recategorized";
  await prisma.auditEvent.create({
    data: {
      tenantId: tenant.id,
      actorId: actor?.id,
      action,
      entity: `ticket:${id}`,
      meta: {
        ...(data.assigneeId !== undefined ? { from: ticket.assigneeId, to: data.assigneeId } : {}),
        ...(data.category !== undefined ? { fromCategory: ticket.category, toCategory: data.category } : {}),
      },
    },
  });
  const providerArchived = data.status === "archived" ? await syncArchiveToProvider(id) : false;
  return NextResponse.json({ ok: true, ...data, providerArchived });
}
