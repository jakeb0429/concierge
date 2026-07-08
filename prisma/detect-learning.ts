import { PrismaClient } from "@prisma/client";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Learning-signal detector — mines the Ledger into human-gated Brain proposals.
 * This is the consolidation step of the two-store architecture: the Ledger
 * (AuditEvent + Draft rows) is complete and never prompted; only what this
 * detector surfaces — and a human approves — mutates the Brain.
 *
 *   recurring_edit : ≥N rep edits on drafts citing the same KnowledgeItem →
 *                    propose ONE revised canonical answer (update, not append)
 *   recurring_steer: the same steer used ≥N times → propose a voice-guide rule
 *
 * Never auto-applies. Signals land as status:"open" for the Brain manager.
 * Usage: tsx prisma/detect-learning.ts [minOccurrences=2]
 */

// Sonnet is plenty for gated proposals (2026-07-04 cost tuning) — a human
// approves every signal, so a weaker model can't hurt the Brain.
const CLAUDE_MODEL = "claude-sonnet-5";
const prisma = new PrismaClient();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MIN = Number(process.argv[2] ?? 2);

const PROPOSE_TOOL = {
  name: "propose_revision",
  description: "Propose a revised canonical answer, or decline if the edits don't converge.",
  input_schema: {
    type: "object" as const,
    properties: {
      converges: { type: "boolean", description: "Do the edits point in one consistent direction?" },
      proposedText: { type: "string", description: "The full revised canonical answer. Omit if not converging." },
      rationale: { type: "string" },
    },
    required: ["converges", "rationale"],
  },
};

async function main() {
  const rheos = await prisma.tenant.findUniqueOrThrow({ where: { slug: "rheos" } });

  // ---- recurring_edit: edits grouped by the knowledge item the draft cited ----
  const edits = await prisma.auditEvent.findMany({
    where: { tenantId: rheos.id, action: "draft_edited" },
    orderBy: { createdAt: "asc" },
  });
  const byItem = new Map<string, { draftId: string; from: string; to: string }[]>();
  for (const e of edits) {
    const meta = e.meta as { draftId?: string; from?: string; to?: string } | null;
    if (!meta?.draftId || !meta.from || !meta.to) continue;
    const citations = await prisma.draftCitation.findMany({
      where: { draftId: meta.draftId },
      select: { knowledgeItemId: true },
    });
    for (const c of citations) {
      if (!byItem.has(c.knowledgeItemId)) byItem.set(c.knowledgeItemId, []);
      byItem.get(c.knowledgeItemId)!.push({ draftId: meta.draftId, from: meta.from, to: meta.to });
    }
  }

  let created = 0;
  for (const [itemId, itemEdits] of byItem) {
    if (itemEdits.length < MIN) continue;
    const open = await prisma.learningSignal.findFirst({
      where: { tenantId: rheos.id, knowledgeItemId: itemId, kind: "recurring_edit", status: "open" },
    });
    if (open) continue; // one open proposal per item at a time
    const item = await prisma.knowledgeItem.findUnique({ where: { id: itemId } });
    if (!item) continue;

    const res = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      // Sonnet defaults to adaptive thinking ON — it would eat the 1024-token
      // budget before the forced tool output. Keep disabled (see 7/4 handoff).
      thinking: { type: "disabled" },
      tools: [PROPOSE_TOOL],
      tool_choice: { type: "tool", name: "propose_revision" },
      system:
        "Reps keep editing AI drafts that were grounded in one canonical answer. If their edits " +
        "converge on a consistent improvement, propose ONE revised canonical answer that would have " +
        "made the edits unnecessary. Keep it concise and factual — do not invent policy not present " +
        "in the edits or the current answer.",
      messages: [
        {
          role: "user",
          content:
            `Current canonical answer ("${item.title}"):\n${item.answer}\n\n` +
            itemEdits
              .map((e, i) => `Edit ${i + 1}:\nAI draft: ${e.from.slice(0, 700)}\nRep's final: ${e.to.slice(0, 700)}`)
              .join("\n\n"),
        },
      ],
    });
    const call = res.content.find((c) => c.type === "tool_use");
    if (!call || call.type !== "tool_use") continue;
    const out = call.input as { converges: boolean; proposedText?: string; rationale: string };
    if (!out.converges || !out.proposedText) continue;

    await prisma.learningSignal.create({
      data: {
        tenantId: rheos.id,
        kind: "recurring_edit",
        knowledgeItemId: itemId,
        proposedText: out.proposedText,
        proposedTarget: "answer",
        occurrences: itemEdits.length,
        evidence: { draftIds: itemEdits.map((e) => e.draftId), rationale: out.rationale },
      },
    });
    created++;
    console.log(`  signal: recurring_edit on "${item.title}" (${itemEdits.length} edits)`);
  }

  // ---- recurring_steer: the same freeform steer keeps being requested ----
  const steered = await prisma.draft.findMany({
    where: { tenantId: rheos.id, steerNotes: { not: null } },
    select: { steerNotes: true },
  });
  const steerCounts = new Map<string, number>();
  for (const s of steered) {
    const key = s.steerNotes!.toLowerCase().trim();
    steerCounts.set(key, (steerCounts.get(key) ?? 0) + 1);
  }
  for (const [note, n] of steerCounts) {
    if (n < Math.max(MIN, 3)) continue;
    const open = await prisma.learningSignal.findFirst({
      where: { tenantId: rheos.id, kind: "recurring_steer", proposedText: { contains: note }, status: "open" },
    });
    if (open) continue;
    await prisma.learningSignal.create({
      data: {
        tenantId: rheos.id,
        kind: "recurring_steer",
        proposedText: `Reps repeatedly steer drafts with: "${note}". Consider adding this as a standing voice rule.`,
        proposedTarget: "voice_guide",
        occurrences: n,
        evidence: { steerNote: note },
      },
    });
    created++;
    console.log(`  signal: recurring_steer "${note}" (${n}×)`);
  }

  console.log(`Detector done: ${edits.length} edits + ${steered.length} steers scanned → ${created} new signal(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
