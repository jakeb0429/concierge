import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { sessionUser } from "@/lib/roles";
import { sendEmail, escapeHtml } from "@/lib/email";
import { baseUrl } from "@/lib/base-url";
import { logger } from "@/lib/log";
import { parseBody } from "@/lib/validate";
import { AGENT_USER_EMAIL } from "@/lib/agent-user";
import { routeSignalAssignee } from "@/lib/assign";

const bodySchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

/**
 * Reply in an internal question's discussion. The first answer from anyone
 * but the asker flips the question to "answered"; the asker replying keeps
 * (or puts) it back to "open" — a follow-up means they still need the team.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await getCurrentTenant();
  const me = await sessionUser();
  if (!me?.id) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const body = await parseBody(req, bodySchema);
  if (body instanceof NextResponse) return body;

  const question = await prisma.ticketQuestion.findFirst({
    where: { id, tenantId: tenant.id },
    include: {
      askedBy: { select: { id: true, email: true } },
      assignee: { select: { id: true, email: true } },
      ticket: { select: { id: true, subject: true, status: true, category: true } },
    },
  });
  if (!question) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (question.status === "closed")
    return NextResponse.json({ error: "This question is closed — reopen it to continue." }, { status: 400 });

  const fromAsker = me.id === question.askedById;
  const reply = await prisma.ticketQuestionReply.create({
    data: { tenantId: tenant.id, questionId: question.id, authorId: me.id, body: body.body },
  });
  const nextStatus = fromAsker ? "open" : "answered";
  // Unconditional update: even a same-status reply must bump updatedAt — the
  // /questions queue orders by it, so active discussions stay near the top.
  await prisma.ticketQuestion.update({ where: { id: question.id }, data: { status: nextStatus } });
  await prisma.auditEvent.create({
    data: {
      tenantId: tenant.id,
      actorId: me.id,
      action: fromAsker ? "question_followed_up" : "question_answered",
      entity: `ticket:${question.ticketId}`,
      meta: { questionId: question.id, replyId: reply.id },
    },
  });

  // AUTO-ESCALATION close-out: a teammate just answered a question the AGENT
  // asked. Put the ticket back in the reply queue (its next draft is grounded
  // in this answer) and propose the Q&A to the Brain so the gap closes for
  // good. Best-effort — a hiccup here must never fail the teammate's reply.
  const answeredAgentGap = !fromAsker && question.askedBy.email === AGENT_USER_EMAIL;
  if (answeredAgentGap) {
    try {
      if (question.ticket.status === "awaiting_internal") {
        await prisma.ticket.update({ where: { id: question.ticketId }, data: { status: "new" } });
      }
      const signalAssignee = await routeSignalAssignee(tenant.id, question.ticket.category);
      const signal = await prisma.learningSignal.create({
        data: {
          tenantId: tenant.id,
          kind: "coverage_gap",
          proposedText: body.body,
          proposedTarget: "new_entry",
          category: question.ticket.category,
          assigneeId: signalAssignee,
          evidence: {
            ticketId: question.ticketId,
            questionId: question.id,
            replyId: reply.id,
            title: question.body,
            category: question.ticket.category,
          },
        },
      });
      await prisma.auditEvent.create({
        data: {
          tenantId: tenant.id,
          actorId: me.id,
          action: "coverage_gap_learned",
          entity: `ticket:${question.ticketId}`,
          meta: { questionId: question.id, signalId: signal.id },
        },
      });
    } catch (e) {
      logger.error({ err: e, questionId: question.id }, "[questions] coverage-gap close-out failed");
    }
  }

  // Tell the person waiting on this — the asker when someone answers, the
  // assignee when the asker follows up. Best-effort.
  const notify = fromAsker ? question.assignee : question.askedBy;
  // Never email the agent bot (it "asked" but has no inbox); the answered
  // ticket re-surfaces in the reply queue instead.
  if (notify && notify.id !== me.id && notify.email !== AGENT_USER_EMAIL) {
    const link = `${baseUrl(req)}/tickets/${question.ticketId}/qa`;
    try {
      const who = me.email || "A teammate";
      const about = (question.ticket.subject ?? "no subject").slice(0, 80);
      await sendEmail({
        to: [notify.email],
        subject: fromAsker ? "Follow-up on a Concierge question" : "Your Concierge question was answered",
        text: `${who} wrote on "${about}":\n\n"${body.body}"\n\nView the discussion: ${link}`,
        // Bodies, subjects, and names are user/customer text — escape them.
        html: `<p><b>${escapeHtml(who)}</b> wrote on "${escapeHtml(about)}":</p><blockquote>${escapeHtml(body.body)}</blockquote><p><a href="${link}">View the discussion</a></p>`,
      });
    } catch (e) {
      logger.error({ err: e, questionId: question.id }, "[questions] reply notification failed");
    }
  }

  return NextResponse.json({ ok: true, replyId: reply.id, status: nextStatus });
}
