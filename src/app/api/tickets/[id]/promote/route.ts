import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { cleanEmailText } from "@/lib/email-clean";

/**
 * Promote a sent reply into the Brand Brain — the flywheel's UI arm.
 * Lands as status:"draft" for approval in the Brain manager (human-gated).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await getCurrentTenant();
  const { draftId } = (await req.json()) as { draftId: string };

  const ticket = await prisma.ticket.findFirst({
    where: { id, tenantId: tenant.id },
    include: { messages: { where: { direction: "inbound" }, orderBy: { sentAt: "asc" }, take: 1 } },
  });
  const draft = await prisma.draft.findFirst({ where: { id: draftId, ticketId: id, status: "sent" } });
  if (!ticket || !draft) return NextResponse.json({ error: "Sent draft not found." }, { status: 404 });

  const question = cleanEmailText(ticket.messages[0]?.text ?? "").slice(0, 160) || (ticket.subject ?? "Customer question");
  const item = await prisma.knowledgeItem.create({
    data: {
      tenantId: tenant.id,
      kind: "faq",
      title: (ticket.subject ?? question).replace(/^re:\s*/i, "").slice(0, 120),
      answer: draft.editedBody ?? draft.body,
      triggerPhrases: [],
      tags: ["promoted"],
      category: "Promoted answers",
      status: "draft", // approved by a human in the Brain manager before it grounds replies
      sourceRef: `promoted from ticket ${id}`,
    },
  });
  await prisma.auditEvent.create({
    data: { tenantId: tenant.id, action: "answer_promoted", entity: `knowledge:${item.id}`, meta: { ticketId: id, draftId } },
  });
  return NextResponse.json({ ok: true, knowledgeItemId: item.id });
}
