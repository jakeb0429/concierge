import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { sessionUser } from "@/lib/roles";
import { syncArchiveToProvider } from "@/lib/archive";
import { INQUIRY_CATEGORIES } from "@/lib/categories";
import { PRIORITIES } from "@/lib/priority";
import { parseBody } from "@/lib/validate";

const bodySchema = z.object({
  // Only the transitions a rep sets by hand — "drafted"/"replied" are system-set.
  status: z.enum(["new", "in_review", "resolved", "archived"]).optional(),
  assigneeId: z.string().nullable().optional(),
  category: z.enum(INQUIRY_CATEGORIES).optional(),
  priority: z.enum(PRIORITIES).optional(),
});

/** Rep ticket actions: archive / resolve / reopen, reassign, recategorize,
 *  reprioritize (triage over-flags; the rep is the corrective).
 *  Archiving also archives the thread in the real mailbox (best-effort). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await getCurrentTenant();
  const body = await parseBody(req, bodySchema);
  if (body instanceof NextResponse) return body;

  const ticket = await prisma.ticket.findFirst({ where: { id, tenantId: tenant.id } });
  if (!ticket) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const actor = await sessionUser();
  const data: { status?: string; assigneeId?: string | null; category?: string; priority?: string } = {};

  if (body.status !== undefined) data.status = body.status;
  if (body.assigneeId !== undefined) {
    if (body.assigneeId !== null) {
      const assignee = await prisma.user.findFirst({ where: { id: body.assigneeId, tenantId: tenant.id } });
      if (!assignee) return NextResponse.json({ error: "Unknown assignee." }, { status: 400 });
    }
    data.assigneeId = body.assigneeId;
  }
  if (body.category !== undefined) data.category = body.category;
  if (body.priority !== undefined) data.priority = body.priority;
  if (Object.keys(data).length === 0)
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  await prisma.ticket.update({ where: { id }, data });

  const action =
    data.status !== undefined
      ? `ticket_${data.status}`
      : data.assigneeId !== undefined
        ? "ticket_reassigned"
        : data.priority !== undefined
          ? "ticket_reprioritized"
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
        ...(data.priority !== undefined ? { fromPriority: ticket.priority, toPriority: data.priority } : {}),
      },
    },
  });
  const providerArchived = data.status === "archived" ? await syncArchiveToProvider(id) : false;
  return NextResponse.json({ ok: true, ...data, providerArchived });
}
