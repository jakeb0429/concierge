import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { anthropic, CLAUDE_MODEL } from "@/lib/anthropic";

/**
 * Teach the Brain from the reply page: a rep submits a correction to a cited
 * entry ("that PO has arrived") or a net-new learning (a policy the Brain
 * doesn't know yet). Never mutates the Brain directly — lands as an open
 * LearningSignal for the Brain manager, same gate as the nightly detector.
 * Body: { note: string, knowledgeItemId?: string, draftId?: string }
 */

const REVISE_TOOL = {
  name: "propose_revision",
  description: "Produce the full revised canonical answer incorporating the rep's correction.",
  input_schema: {
    type: "object" as const,
    properties: {
      proposedText: {
        type: "string",
        description:
          "The complete revised canonical answer — the current answer with the rep's correction applied. Not a diff.",
      },
      rationale: { type: "string" },
    },
    required: ["proposedText", "rationale"],
  },
};

const ENTRY_TOOL = {
  name: "propose_entry",
  description: "Turn the rep's note into a canonical Brand Brain entry.",
  input_schema: {
    type: "object" as const,
    properties: {
      title: { type: "string", description: "Short question-style title for the entry." },
      answer: { type: "string", description: "Concise canonical answer, factual, no invention beyond the note." },
      category: { type: "string", description: "Existing-style category, e.g. Policies, Products, Shipping." },
    },
    required: ["title", "answer"],
  },
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: ticketId } = await params;
  const tenant = await getCurrentTenant();
  const { note, knowledgeItemId, draftId } = (await req.json()) as {
    note?: string;
    knowledgeItemId?: string;
    draftId?: string;
  };
  if (!note?.trim()) return NextResponse.json({ error: "A note is required." }, { status: 400 });

  // ---- correction to a specific (usually cited) entry ----
  if (knowledgeItemId) {
    const item = await prisma.knowledgeItem.findFirst({
      where: { id: knowledgeItemId, tenantId: tenant.id },
    });
    if (!item) return NextResponse.json({ error: "Entry not found." }, { status: 404 });

    // One open correction per entry: fold repeat submissions into the same proposal.
    const open = await prisma.learningSignal.findFirst({
      where: { tenantId: tenant.id, knowledgeItemId: item.id, kind: "rep_correction", status: "open" },
    });
    const priorNotes = ((open?.evidence as { notes?: string[] } | null)?.notes ?? []).slice(-5);
    const notes = [...priorNotes, note.trim()];

    let proposedText = note.trim();
    let rationale = "Model synthesis unavailable — raw rep note stored as the proposal.";
    try {
      const res = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        tools: [REVISE_TOOL],
        tool_choice: { type: "tool", name: "propose_revision" },
        system:
          "A support rep flagged a canonical Brand Brain answer as wrong or out of date and supplied " +
          "the correction. Rewrite the canonical answer with the correction applied. Keep everything " +
          "that is still true, change only what the correction contradicts, and do not invent facts " +
          "beyond the current answer and the rep's notes.",
        messages: [
          {
            role: "user",
            content:
              `Current canonical answer ("${item.title}", v${item.version}` +
              (item.sourceRef ? `, source: ${item.sourceRef}` : "") +
              `):\n${item.answer}\n\nRep correction(s), newest last:\n` +
              notes.map((n, i) => `${i + 1}. ${n}`).join("\n"),
          },
        ],
      });
      const call = res.content.find((c) => c.type === "tool_use");
      if (call && call.type === "tool_use") {
        const out = call.input as { proposedText: string; rationale: string };
        proposedText = out.proposedText;
        rationale = out.rationale;
      }
    } catch (e) {
      console.error("[teach] revision synthesis failed, storing raw note:", e);
    }

    const evidence = {
      ticketId,
      draftId: draftId ?? null,
      notes,
      sourceRef: item.sourceRef,
      itemVersion: item.version,
      rationale,
    };
    const signal = open
      ? await prisma.learningSignal.update({
          where: { id: open.id },
          data: { proposedText, occurrences: { increment: 1 }, evidence },
        })
      : await prisma.learningSignal.create({
          data: {
            tenantId: tenant.id,
            kind: "rep_correction",
            knowledgeItemId: item.id,
            proposedText,
            proposedTarget: "answer",
            evidence,
          },
        });

    await prisma.auditEvent.create({
      data: {
        tenantId: tenant.id,
        action: "correction_submitted",
        entity: `ticket:${ticketId}`,
        meta: { signalId: signal.id, knowledgeItemId: item.id, note: note.trim() },
      },
    });
    return NextResponse.json({ signalId: signal.id, kind: "rep_correction", itemTitle: item.title });
  }

  // ---- net-new learning, not tied to any citation ----
  let title = "Learning from a live ticket";
  let answer = note.trim();
  let category: string | null = null;
  try {
    const res = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      tools: [ENTRY_TOOL],
      tool_choice: { type: "tool", name: "propose_entry" },
      system:
        "A support rep wants the Brand Brain to learn something new they used while answering a real " +
        "ticket. Turn their note into one concise canonical entry. Stick strictly to the facts in the " +
        "note — no invention, no padding.",
      messages: [{ role: "user", content: note.trim() }],
    });
    const call = res.content.find((c) => c.type === "tool_use");
    if (call && call.type === "tool_use") {
      const out = call.input as { title: string; answer: string; category?: string };
      title = out.title;
      answer = out.answer;
      category = out.category ?? null;
    }
  } catch (e) {
    console.error("[teach] entry synthesis failed, storing raw note:", e);
  }

  const signal = await prisma.learningSignal.create({
    data: {
      tenantId: tenant.id,
      kind: "rep_learning",
      proposedText: answer,
      proposedTarget: "new_entry",
      evidence: { ticketId, draftId: draftId ?? null, notes: [note.trim()], title, category },
    },
  });
  await prisma.auditEvent.create({
    data: {
      tenantId: tenant.id,
      action: "learning_submitted",
      entity: `ticket:${ticketId}`,
      meta: { signalId: signal.id, note: note.trim() },
    },
  });
  return NextResponse.json({ signalId: signal.id, kind: "rep_learning", itemTitle: title });
}
