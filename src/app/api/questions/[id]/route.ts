import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { sessionUser, isAdminRole } from "@/lib/roles";
import { parseBody } from "@/lib/validate";

const bodySchema = z.object({
  // closed = the asker got what they needed; open = reopened for more.
  status: z.enum(["open", "closed"]),
});

/** Close or reopen an internal question (clears it from the answer queues).
 *  Asker-only (admins can tidy stale ones) — enforced HERE, not just in the
 *  UI: "closed" means the asker got what they needed. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await getCurrentTenant();
  const me = await sessionUser();
  if (!me?.id) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const body = await parseBody(req, bodySchema);
  if (body instanceof NextResponse) return body;

  const question = await prisma.ticketQuestion.findFirst({ where: { id, tenantId: tenant.id } });
  if (!question) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (question.askedById !== me.id && !isAdminRole(me.role))
    return NextResponse.json({ error: "Only the asker (or an admin) can close or reopen a question." }, { status: 403 });

  await prisma.ticketQuestion.update({ where: { id }, data: { status: body.status } });
  await prisma.auditEvent.create({
    data: {
      tenantId: tenant.id,
      actorId: me.id,
      action: body.status === "closed" ? "question_closed" : "question_reopened",
      entity: `ticket:${question.ticketId}`,
      meta: { questionId: id },
    },
  });
  return NextResponse.json({ ok: true, status: body.status });
}
