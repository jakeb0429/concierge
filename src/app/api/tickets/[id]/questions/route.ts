import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { sessionUser } from "@/lib/roles";
import { sendEmail, escapeHtml } from "@/lib/email";
import { baseUrl } from "@/lib/base-url";
import { logger } from "@/lib/log";
import { parseBody } from "@/lib/validate";

const bodySchema = z.object({
  body: z.string().trim().min(3).max(4000),
  assigneeId: z.string().nullable().optional(),
});

/**
 * Ask the team an internal question on a ticket ("who can help with the
 * American flag graphic?"). The assignee gets an email pointing at the
 * stripped-down Q&A view — never at the full workspace. Internal only;
 * nothing here ever reaches the customer.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await getCurrentTenant();
  const me = await sessionUser();
  if (!me?.id) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const body = await parseBody(req, bodySchema);
  if (body instanceof NextResponse) return body;

  const ticket = await prisma.ticket.findFirst({
    where: { id, tenantId: tenant.id },
    select: { id: true, subject: true, customer: { select: { displayName: true } } },
  });
  if (!ticket) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let assignee: { id: string; email: string; name: string | null } | null = null;
  if (body.assigneeId) {
    assignee = await prisma.user.findFirst({
      where: { id: body.assigneeId, tenantId: tenant.id },
      select: { id: true, email: true, name: true },
    });
    if (!assignee) return NextResponse.json({ error: "Unknown assignee." }, { status: 400 });
  }

  const question = await prisma.ticketQuestion.create({
    data: {
      tenantId: tenant.id,
      ticketId: ticket.id,
      askedById: me.id,
      assigneeId: assignee?.id ?? null,
      body: body.body,
    },
  });
  await prisma.auditEvent.create({
    data: {
      tenantId: tenant.id,
      actorId: me.id,
      action: "question_asked",
      entity: `ticket:${ticket.id}`,
      meta: { questionId: question.id, assigneeId: assignee?.id ?? null },
    },
  });

  // Notify the assignee (never yourself) — best-effort, the question exists
  // either way and shows in their queue.
  if (assignee && assignee.id !== me.id) {
    const link = `${baseUrl(req)}/tickets/${ticket.id}/qa`;
    const who = me.email || "a teammate";
    const about = `${ticket.customer.displayName ?? "a customer"} — "${(ticket.subject ?? "no subject").slice(0, 80)}"`;
    try {
      await sendEmail({
        to: [assignee.email],
        subject: `Quick question for you on a Concierge ticket`,
        text: `${who} asked you a question about ${about}:\n\n"${body.body}"\n\nAnswer here (takes a minute): ${link}`,
        // Bodies, subjects, and names are user/customer text — escape them.
        html: `<p><b>${escapeHtml(who)}</b> asked you a question about ${escapeHtml(about)}:</p><blockquote>${escapeHtml(body.body)}</blockquote><p><a href="${link}">Answer here</a> — it takes a minute, and only the team sees it.</p>`,
      });
    } catch (e) {
      logger.error({ err: e, questionId: question.id }, "[questions] assignee notification failed");
    }
  }

  return NextResponse.json({ ok: true, questionId: question.id });
}
