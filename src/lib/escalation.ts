import { prisma } from "./db";
import { sendEmail, escapeHtml } from "./email";
import { getAgentUser } from "./agent-user";
import { routeSignalAssignee } from "./assign";

/**
 * Auto-escalation: when the Brain cannot answer a ticket (draft coverage
 * "none"), the agent asks the right specialist instead of sending a hollow
 * reply. On the teammate's answer the ticket re-enters the queue and the next
 * draft is grounded in that answer (see expertAnswerContext), and the Q&A is
 * proposed to the Brain so the gap closes for good.
 */

const FALLBACK_QUESTION =
  "The agent couldn't answer this ticket from the Brain. Can you tell us how to respond?";

export async function escalateCoverageGap(params: {
  tenantId: string;
  ticket: { id: string; category: string | null; subject: string | null };
  gapQuestion?: string;
  coverageNote?: string;
  link: string;
  actorId?: string | null;
}): Promise<{ alreadyAsked: boolean; question: string; assigneeName: string | null }> {
  const { tenantId, ticket, link } = params;
  const agent = await getAgentUser(tenantId);

  // Dedup: one open/answered agent question per ticket — never re-ask a gap
  // that's already pending or answered.
  const existing = await prisma.ticketQuestion.findFirst({
    where: { tenantId, ticketId: ticket.id, askedById: agent.id, status: { in: ["open", "answered"] } },
    select: { body: true, assignee: { select: { name: true, email: true } } },
  });
  if (existing) {
    return {
      alreadyAsked: true,
      question: existing.body,
      assigneeName: existing.assignee?.name ?? existing.assignee?.email?.split("@")[0] ?? null,
    };
  }

  const question = (params.gapQuestion || params.coverageNote || FALLBACK_QUESTION).trim();
  const assigneeId = await routeSignalAssignee(tenantId, ticket.category);
  const assignee = assigneeId
    ? await prisma.user.findFirst({ where: { id: assigneeId, tenantId }, select: { id: true, name: true, email: true } })
    : null;

  await prisma.ticketQuestion.create({
    data: { tenantId, ticketId: ticket.id, askedById: agent.id, assigneeId: assignee?.id ?? null, body: question },
  });
  // Park the ticket out of the needs-a-reply queue until the teammate answers.
  await prisma.ticket.update({ where: { id: ticket.id }, data: { status: "awaiting_internal" } });
  await prisma.auditEvent.create({
    data: {
      tenantId,
      actorId: params.actorId ?? null,
      action: "coverage_escalated",
      entity: `ticket:${ticket.id}`,
      meta: { question, assigneeId: assignee?.id ?? null },
    },
  });

  // Ping the specialist, same as a human-asked team question.
  if (assignee?.email) {
    const about = ticket.subject ? `"${ticket.subject}"` : "a customer ticket";
    await sendEmail({
      to: [assignee.email],
      subject: "The Concierge agent needs your help on a ticket",
      text: `The agent hit a knowledge gap on ${ticket.subject ?? "a ticket"} and needs your answer:\n\n"${question}"\n\nAnswer here and it will draft the customer reply for you: ${link}`,
      html: `<p>The Concierge agent hit a knowledge gap on ${escapeHtml(about)} and needs your answer:</p><blockquote>${escapeHtml(question)}</blockquote><p><a href="${link}">Answer here</a> and it will draft the customer reply for you.</p>`,
    }).catch(() => {});
  }

  return { alreadyAsked: false, question, assigneeName: assignee?.name ?? assignee?.email?.split("@")[0] ?? null };
}

/**
 * Trusted live-context lines for a ticket's answered agent-escalation
 * questions, so the re-draft after a teammate answers is grounded in that
 * answer. Returns [] when there are none.
 */
export async function expertAnswerContext(tenantId: string, ticketId: string): Promise<string[]> {
  const agent = await getAgentUser(tenantId);
  const questions = await prisma.ticketQuestion.findMany({
    where: { tenantId, ticketId, askedById: agent.id, status: "answered" },
    select: {
      body: true,
      replies: {
        where: { authorId: { not: agent.id } },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { body: true },
      },
    },
  });
  const lines: string[] = [];
  for (const q of questions) {
    const answer = q.replies[0];
    if (answer?.body) {
      lines.push(`Internal expert answer (verified) to "${q.body}": ${answer.body}`);
    }
  }
  return lines;
}
