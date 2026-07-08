import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateDraft } from "@/lib/brain/draft";
import { cleanEmailText } from "@/lib/email-clean";
import { getOrderContext, orderContextLines } from "@/lib/shipstation";
import { getCustomerInsight } from "@/lib/customer-insight";
import { groundingNotes } from "@/lib/notes";

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
      customer: true,
      messages: { where: { direction: "inbound" }, orderBy: { sentAt: "asc" } },
    },
  });

  let ticketText = ticket.messages
    .map((m) => {
      const atts = (m.attachments as { filename: string }[] | null) ?? [];
      const note = atts.length ? `\n[customer attached: ${atts.map((a) => a.filename).join(", ")}]` : "";
      return cleanEmailText(m.text) + note;
    })
    .join("\n\n");

  // Live order context (ShipStation, cached, fail-soft) — lets shipping/order
  // drafts reference the customer's ACTUAL order state instead of hedging.
  const orders = await getOrderContext(ticket.customer.email);
  if (orders.length) {
    ticketText += `\n\n[order context from the fulfillment system — factual, safe to reference: ${orderContextLines(orders).join(" | ")}]`;
  }
  // The AI customer read + rep-entered channel facts — tone and context, not
  // policy: grounding facts still come only from the Brand Brain.
  const insight = await getCustomerInsight(ticket.customer.id).catch(() => null);
  if (insight) ticketText += `\n\n[customer context — for tone and relevance, not for policy claims: ${insight}]`;
  if (ticket.customer.purchaseChannel) {
    ticketText += `\n[known purchase channel: ${ticket.customer.purchaseChannel}${ticket.customer.channelName ? ` — ${ticket.customer.channelName}` : ""}]`;
  }
  // Rep-pinned context notes (this ticket + this customer, unexpired only) —
  // team-vetted facts, safe to reference directly.
  const notes = await groundingNotes(ticket.tenantId, ticket.id, ticket.customerId);
  if (notes.length) ticketText += `\n\n[team notes — factual, safe to reference: ${notes.join(" | ")}]`;
  const prior = regenOfDraftId
    ? await prisma.draft.findFirst({ where: { id: regenOfDraftId, ticketId: ticket.id } })
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
    select: { id: true, title: true, sourceRef: true, version: true },
  });
  const validIds = new Set(validItems.map((i) => i.id));
  const itemById = new Map(validItems.map((i) => [i.id, i]));

  const draft = await prisma.draft.create({
    data: {
      tenantId: ticket.tenantId,
      ticketId: ticket.id,
      body: result.body,
      coverage: result.coverage,
      coverageNote: result.coverageNote,
      policyFlags: result.policyFlags,
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
      .map((c) => {
        const item = itemById.get(c.knowledgeItemId)!;
        return { id: c.knowledgeItemId, title: item.title, score: c.score, sourceRef: item.sourceRef, version: item.version };
      }),
  });
}
