import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateDraft } from "@/lib/brain/draft";
import { cleanEmailText } from "@/lib/email-clean";
import { getOrderContext, orderContextLines } from "@/lib/shipstation";
import { getCustomerInsight } from "@/lib/customer-insight";
import { groundingNotes } from "@/lib/notes";
import { findStockists, stockistLines, detectPlace } from "@/lib/stockists";
import { extractProductMention } from "@/lib/product-extract";
import { getCurrentTenant } from "@/lib/tenant";
import { sessionUser } from "@/lib/roles";
import { checkReturnEligibility } from "@/lib/returns";
import { z } from "zod";
import { parseBody } from "@/lib/validate";

const bodySchema = z.object({
  steerNotes: z.string().optional(),
  regenOfDraftId: z.string().optional(),
  // guided returns (Phase A): compute eligibility, ground the draft in it,
  // and mark the ticket's return lifecycle as requested
  startReturn: z.boolean().optional(),
});

const RETURN_STEER =
  "The customer wants a return or exchange. Use the system-computed return eligibility " +
  "facts from live context: if eligible, lay out the clear next steps to start the return " +
  "or exchange, and offer an exchange first where it feels natural; if not eligible or " +
  "flagged for review, kindly explain what we can and cannot do. Never promise a specific " +
  "refund amount or timeline that is not in the grounding.";

/**
 * Prepare (or regenerate) a first draft for a ticket. Grounded, cited, scored.
 * Body: { steerNotes?: string, regenOfDraftId?: string, startReturn?: boolean }
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseBody(req, bodySchema);
  if (parsed instanceof NextResponse) return parsed;
  const { steerNotes, regenOfDraftId, startReturn } = parsed;

  const currentTenant = await getCurrentTenant();
  const ticket = await prisma.ticket.findFirst({
    where: { id, tenantId: currentTenant.id },
    include: {
      tenant: true,
      customer: true,
      messages: { where: { direction: "inbound" }, orderBy: { sentAt: "asc" } },
    },
  });
  if (!ticket) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const ticketText = ticket.messages
    .map((m) => {
      const atts = (m.attachments as { filename: string }[] | null) ?? [];
      const note = atts.length ? `\n[customer attached: ${atts.map((a) => a.filename).join(", ")}]` : "";
      return cleanEmailText(m.text) + note;
    })
    .join("\n\n");

  // Verified live context — facts WE fetched (never trusted from the customer
  // message itself): order status, customer read, channel, team notes,
  // stockists. Passed to the engine as its own trusted section.
  const liveContext: string[] = [];
  const orders = await getOrderContext(ticket.customer.email, ticket.tenantId);
  if (orders.length)
    liveContext.push(`Order status (fulfillment system): ${orderContextLines(orders).join(" | ")}`);
  const insight = await getCustomerInsight(ticket.customer.id).catch(() => null);
  if (insight) liveContext.push(`Customer read (for tone/relevance, not policy claims): ${insight}`);
  if (ticket.customer.purchaseChannel)
    liveContext.push(
      `Known purchase channel: ${ticket.customer.purchaseChannel}${ticket.customer.channelName ? ` — ${ticket.customer.channelName}` : ""}`
    );
  const detected = await extractProductMention(`${ticket.subject ?? ""}\n${ticketText.slice(0, 2000)}`);
  const notes = await groundingNotes(ticket.tenantId, ticket.id, ticket.customerId, detected.productFamily);
  if (notes.length) liveContext.push(`Team notes (rep-vetted facts): ${notes.join(" | ")}`);
  // "Where can I buy X in person?" → real stockist data (wholesale accounts
  // that recently ordered it), scoped to a place they named if we recognize one.
  if (/in[- ]?person|near\s?(me|by)|\blocal|\bstore\b|\bstores\b|\bretail|where .{0,30}(buy|find|get)|stockist|carr(y|ies)/i.test(ticketText)) {
    const pm = detected;
    const place = await detectPlace(ticket.tenantId, ticketText);
    const hits = await findStockists({
      tenantId: ticket.tenantId,
      productFamily: pm.productFamily,
      place,
      months: 12,
      limit: place ? 6 : 10,
    });
    if (hits.length) {
      liveContext.push(
        `Retail stockists that RECENTLY ORDERED ${pm.productFamily ?? "our products"} wholesale${place ? ` near ${place}` : ""} (order history, not live shelf stock — suggest the customer call ahead; prefer the ones nearest their stated location): ${stockistLines(hits, pm.productFamily).join(" | ")}`
      );
    }
  }
  // Guided return: eligibility verdict + facts join the trusted context.
  const eligibility = startReturn ? await checkReturnEligibility(ticket.customer, ticket.tenantId) : null;
  if (eligibility) liveContext.push(...eligibility.liveContext);

  const prior = regenOfDraftId
    ? await prisma.draft.findFirst({ where: { id: regenOfDraftId, ticketId: ticket.id } })
    : null;

  // Drafts sign off as the person who'll send them — the signed-in rep.
  const me = await sessionUser();
  const repUser = me ? await prisma.user.findUnique({ where: { id: me.id }, select: { name: true } }) : null;
  const repName = repUser?.name?.split(" ")[0] ?? null;

  const result = await generateDraft({
    tenantId: ticket.tenantId,
    ticketText,
    voiceGuide: ticket.tenant.voiceGuide,
    steerNotes: startReturn ? [RETURN_STEER, steerNotes].filter(Boolean).join(" ") : steerNotes,
    priorDraftBody: prior?.editedBody ?? prior?.body ?? undefined,
    liveContext,
    repName,
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

  await prisma.ticket.update({
    where: { id: ticket.id },
    data: { status: "in_review", ...(eligibility ? { returnStatus: "requested" } : {}) },
  });
  await prisma.auditEvent.create({
    data: {
      tenantId: ticket.tenantId,
      action: regenOfDraftId ? "draft_regenerated" : "draft_generated",
      entity: `ticket:${ticket.id}`,
      meta: { draftId: draft.id, coverage: result.coverage, steerNotes: steerNotes ?? null },
    },
  });
  if (eligibility) {
    await prisma.auditEvent.create({
      data: {
        tenantId: ticket.tenantId,
        actorId: me?.id,
        action: "return_started",
        entity: `ticket:${ticket.id}`,
        meta: { draftId: draft.id, verdict: eligibility.verdict, reasons: eligibility.reasons },
      },
    });
  }

  return NextResponse.json({
    draftId: draft.id,
    body: result.body,
    coverage: result.coverage,
    coverageNote: result.coverageNote ?? null,
    policyFlags: result.policyFlags,
    suggested: result.suggested,
    returnEligibility: eligibility ? { verdict: eligibility.verdict, reasons: eligibility.reasons } : null,
    citations: result.citations
      .filter((c) => validIds.has(c.knowledgeItemId))
      .map((c) => {
        const item = itemById.get(c.knowledgeItemId)!;
        return { id: c.knowledgeItemId, title: item.title, score: c.score, sourceRef: item.sourceRef, version: item.version };
      }),
  });
}
