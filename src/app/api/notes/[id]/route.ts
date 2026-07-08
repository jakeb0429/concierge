import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { sessionUser } from "@/lib/roles";

/** Edit a context note — body text and/or expiration. Passing expiresAt: null
 *  makes the note permanent (the "keep it, drop the date" review action). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await getCurrentTenant();
  const note = await prisma.contextNote.findFirst({ where: { id, tenantId: tenant.id } });
  if (!note) return NextResponse.json({ error: "Note not found." }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { body?: string; expiresAt?: string | null };
  const data: { body?: string; expiresAt?: Date | null } = {};
  if (body.body !== undefined) {
    if (!body.body.trim()) return NextResponse.json({ error: "The note text can't be empty." }, { status: 400 });
    data.body = body.body.trim();
  }
  if (body.expiresAt !== undefined) {
    const d = body.expiresAt ? new Date(body.expiresAt) : null;
    if (d && isNaN(d.getTime())) return NextResponse.json({ error: "Invalid expiration date." }, { status: 400 });
    data.expiresAt = d;
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  const updated = await prisma.contextNote.update({ where: { id }, data });
  const actor = await sessionUser();
  await prisma.auditEvent.create({
    data: {
      tenantId: tenant.id,
      actorId: actor?.id,
      action: "note_updated",
      entity: note.ticketId ? `ticket:${note.ticketId}` : `customer:${note.customerId}`,
      meta: { noteId: id, ...(data.expiresAt !== undefined ? { expiresAt: data.expiresAt?.toISOString() ?? null } : {}) },
    },
  });
  return NextResponse.json({ note: { id: updated.id, body: updated.body, expiresAt: updated.expiresAt } });
}

/** Remove a note — the review action for context that's no longer true. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await getCurrentTenant();
  const note = await prisma.contextNote.findFirst({ where: { id, tenantId: tenant.id } });
  if (!note) return NextResponse.json({ error: "Note not found." }, { status: 404 });

  await prisma.contextNote.delete({ where: { id } });
  const actor = await sessionUser();
  await prisma.auditEvent.create({
    data: {
      tenantId: tenant.id,
      actorId: actor?.id,
      action: "note_removed",
      entity: note.ticketId ? `ticket:${note.ticketId}` : `customer:${note.customerId}`,
      meta: { noteId: id, body: note.body.slice(0, 200) },
    },
  });
  return NextResponse.json({ ok: true });
}
