import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { sessionUser, isAdminRole } from "@/lib/roles";
import { sendEmail, escapeHtml } from "@/lib/email";
import { baseUrl } from "@/lib/base-url";
import { logger } from "@/lib/log";
import { parseBody } from "@/lib/validate";
import { AGENT_USER_EMAIL } from "@/lib/agent-user";

const bodySchema = z.object({
  assigneeId: z.string().min(1),
  comment: z.string().trim().max(2000).optional(),
});

/**
 * Hand an internal question off to a different teammate, with an optional note.
 * The current assignee, the asker, or an admin can reassign. The new assignee
 * gets the question back in their "Waiting on you" queue (status -> open) plus
 * an email, and the note lands as a visible handoff message in the discussion.
 * Internal only; nothing here ever reaches the customer.
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
      ticket: { select: { id: true, subject: true, customer: { select: { displayName: true } } } },
    },
  });
  if (!question) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (question.status === "closed")
    return NextResponse.json({ error: "This question is closed — reopen it before reassigning." }, { status: 400 });

  // The person it's sent to, the asker, or an admin can hand it off — enforced
  // HERE, not just in the UI.
  const canReassign = me.id === question.assigneeId || me.id === question.askedById || isAdminRole(me.role);
  if (!canReassign)
    return NextResponse.json(
      { error: "Only the current assignee, the asker, or an admin can reassign a question." },
      { status: 403 }
    );

  if (body.assigneeId === question.assigneeId)
    return NextResponse.json({ error: "That teammate already has this question." }, { status: 400 });

  const next = await prisma.user.findFirst({
    where: { id: body.assigneeId, tenantId: tenant.id },
    select: { id: true, email: true, name: true },
  });
  if (!next) return NextResponse.json({ error: "Unknown teammate." }, { status: 400 });

  const nextLabel = next.name ?? next.email.split("@")[0];
  const comment = body.comment?.trim();
  const noteBody = comment ? `↪ Reassigned to ${nextLabel}: ${comment}` : `↪ Reassigned to ${nextLabel}`;

  // Reassign + surface it atomically: assignee changes and status returns to
  // "open" so it lands in the new person's queue, and the handoff note is
  // written directly (NOT via the replies route) so it never trips the
  // open->answered transition — a handoff is not an answer.
  const [, note] = await prisma.$transaction([
    prisma.ticketQuestion.update({
      where: { id: question.id },
      data: { assigneeId: next.id, status: "open" },
    }),
    prisma.ticketQuestionReply.create({
      data: { tenantId: tenant.id, questionId: question.id, authorId: me.id, body: noteBody },
    }),
  ]);
  await prisma.auditEvent.create({
    data: {
      tenantId: tenant.id,
      actorId: me.id,
      action: "question_reassigned",
      entity: `ticket:${question.ticketId}`,
      meta: {
        questionId: question.id,
        from: question.assigneeId ?? null,
        to: next.id,
        replyId: note.id,
        hasComment: !!comment,
      },
    },
  });

  // Notify the new assignee (never yourself, never the agent bot) — best-effort,
  // the question shows in their queue either way.
  if (next.id !== me.id && next.email !== AGENT_USER_EMAIL) {
    const link = `${baseUrl(req)}/tickets/${question.ticketId}/qa`;
    const who = me.email || "A teammate";
    const about = `${question.ticket.customer.displayName ?? "a customer"} — "${(question.ticket.subject ?? "no subject").slice(0, 80)}"`;
    try {
      await sendEmail({
        to: [next.email],
        subject: `A Concierge question was reassigned to you`,
        text: `${who} reassigned a question to you about ${about}:\n\n"${question.body}"${comment ? `\n\nTheir note: "${comment}"` : ""}\n\nAnswer here (takes a minute): ${link}`,
        // Bodies, subjects, and names are user/customer text — escape them.
        html: `<p><b>${escapeHtml(who)}</b> reassigned a question to you about ${escapeHtml(about)}:</p><blockquote>${escapeHtml(question.body)}</blockquote>${comment ? `<p>Their note:</p><blockquote>${escapeHtml(comment)}</blockquote>` : ""}<p><a href="${link}">Answer here</a> — only the team sees it.</p>`,
      });
    } catch (e) {
      logger.error({ err: e, questionId: question.id }, "[questions] reassign notification failed");
    }
  }

  return NextResponse.json({ ok: true, assigneeId: next.id });
}
