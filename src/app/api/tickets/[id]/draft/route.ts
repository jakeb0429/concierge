import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateDraft } from "@/lib/brain/draft";
import { cleanEmailText } from "@/lib/email-clean";

/**
 * Prepare (or regenerate) a first draft for a ticket. Grounded, cited, scored.
 * Body: { steerNotes?: string, regenOfDraftId?: string }
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { steerNotes, regenOfDraftId } = (await req.json().catch(() => ({}))) as {
    steerNotes?: string;
    regenOfDraftId?: string;
  };

  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id },
    include: {
      tenant: true,
      messages: { where: { direction: "inbound" }, orderBy: { sentAt: "asc" } },
    },
  });

  const ticketText = ticket.messages.map((m) => cleanEmailText(m.text)).join("\n\n");
  const prior = regenOfDraftId
    ? await prisma.draft.findUnique({ where: { id: regenOfDraftId } })
    : null;

  const result = await generateDraft({
    tenantId: ticket.tenantId,
    ticketText,
    voiceGuide: ticket.tenant.voiceGuide,
    steerNotes,
    priorDraftBody: prior?.editedBody ?? prior?.body ?? undefined,
  });

  // Only cite ids that are real KnowledgeItems in this tenant.
  const citedIds = result.citations.map((c) => c.knowledgeItemId);
  const validItems = await prisma.knowledgeItem.findMany({
    where: { id: { in: citedIds }, tenantId: ticket.tenantId },
    select: { id: true, title: true },
  });
  const validIds = new Set(validItems.map((i) => i.id));
  const titleById = new Map(validItems.map((i) => [i.id, i.title]));

  const draft = await prisma.draft.create({
    data: {
      tenantId: ticket.tenantId,
      ticketId: ticket.id,
      body: result.body,
      coverage: result.coverage,
      coverageNote: result.coverageNote,
      steerNotes: steerNotes,
      regenOf: regenOfDraftId,
      status: regenOfDraftId ? "regenerated" : "prepared",
      citations: {
        create: result.citations
          .filter((c) => validIds.has(c.knowledgeItemId))
          .map((c) => ({ knowledgeItemId: c.knowledgeItemId, score: c.score })),
      },
    },
  });

  // Usage stats — feeds decay + consolidation (the anti-bloat learning loop).
  if (validIds.size) {
    await prisma.knowledgeItem.updateMany({
      where: { id: { in: [...validIds] } },
      data: { timesCited: { increment: 1 }, lastCitedAt: new Date() },
    });
  }

  await prisma.ticket.update({ where: { id: ticket.id }, data: { status: "in_review" } });
  await prisma.auditEvent.create({
    data: {
      tenantId: ticket.tenantId,
      action: regenOfDraftId ? "draft_regenerated" : "draft_generated",
      entity: `ticket:${ticket.id}`,
      meta: { draftId: draft.id, coverage: result.coverage, steerNotes: steerNotes ?? null },
    },
  });

  return NextResponse.json({
    draftId: draft.id,
    body: result.body,
    coverage: result.coverage,
    coverageNote: result.coverageNote ?? null,
    policyFlags: result.policyFlags,
    suggested: result.suggested,
    citations: result.citations
      .filter((c) => validIds.has(c.knowledgeItemId))
      .map((c) => ({ id: c.knowledgeItemId, title: titleById.get(c.knowledgeItemId)!, score: c.score })),
  });
}
