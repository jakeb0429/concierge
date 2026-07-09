import { PrismaClient } from "@prisma/client";
import Anthropic from "@anthropic-ai/sdk";
import { routeSignalAssignee } from "../src/lib/assign";

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

// idempotent: watermark guards — one open signal per item blocks new ones, and only
// evidence newer than the latest resolved signal counts, so re-runs create nothing new.

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
  const editMetas = edits
    .map((e) => ({ ...(e.meta as { draftId?: string; from?: string; to?: string } | null), at: e.createdAt }))
    .filter((m): m is { draftId: string; from: string; to: string; at: Date } => !!(m?.draftId && m.from && m.to));
  // One citations query for every edited draft (was one query per edit).
  const allCitations = await prisma.draftCitation.findMany({
    where: { draftId: { in: editMetas.map((m) => m.draftId) } },
    select: { draftId: true, knowledgeItemId: true },
  });
  const citationsByDraft = new Map<string, string[]>();
  for (const c of allCitations) {
    if (!citationsByDraft.has(c.draftId)) citationsByDraft.set(c.draftId, []);
    citationsByDraft.get(c.draftId)!.push(c.knowledgeItemId);
  }
  const byItem = new Map<string, { draftId: string; from: string; to: string; at: Date }[]>();
  for (const meta of editMetas) {
    for (const itemId of citationsByDraft.get(meta.draftId) ?? []) {
      if (!byItem.has(itemId)) byItem.set(itemId, []);
      byItem.get(itemId)!.push(meta);
    }
  }

  let created = 0;
  for (const [itemId, allItemEdits] of byItem) {
    // Watermark: a resolved (approved/dismissed) signal consumes the evidence
    // that produced it — only edits NEWER than the item's latest signal count,
    // else every resolved proposal resurrects from the same history forever.
    const latest = await prisma.learningSignal.findFirst({
      where: { tenantId: rheos.id, knowledgeItemId: itemId, kind: "recurring_edit" },
      orderBy: { createdAt: "desc" },
      select: { status: true, createdAt: true },
    });
    if (latest?.status === "open") continue; // one open proposal per item at a time
    const itemEdits = latest ? allItemEdits.filter((e) => e.at > latest.createdAt) : allItemEdits;
    if (itemEdits.length < MIN) continue;
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

    // Route the training question to the specialist for the category the
    // edited tickets belong to — majority category across the cited drafts.
    const editedDrafts = await prisma.draft.findMany({
      where: { id: { in: itemEdits.map((e) => e.draftId) } },
      select: { ticket: { select: { category: true } } },
    });
    const catCounts = new Map<string, number>();
    for (const d of editedDrafts)
      if (d.ticket.category) catCounts.set(d.ticket.category, (catCounts.get(d.ticket.category) ?? 0) + 1);
    const category = [...catCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const assigneeId = await routeSignalAssignee(rheos.id, category);

    await prisma.learningSignal.create({
      data: {
        tenantId: rheos.id,
        kind: "recurring_edit",
        knowledgeItemId: itemId,
        proposedText: out.proposedText,
        proposedTarget: "answer",
        occurrences: itemEdits.length,
        category,
        assigneeId,
        evidence: { draftIds: itemEdits.map((e) => e.draftId), rationale: out.rationale },
      },
    });
    created++;
    console.log(`  signal: recurring_edit on "${item.title}" (${itemEdits.length} edits)`);
  }

  // ---- recurring_steer: the same freeform steer keeps being requested ----
  const steered = await prisma.draft.findMany({
    where: { tenantId: rheos.id, steerNotes: { not: null } },
    select: { steerNotes: true, createdAt: true },
  });
  const steerCounts = new Map<string, { n: number; newest: Date }>();
  for (const s of steered) {
    const key = s.steerNotes!.toLowerCase().trim();
    const cur = steerCounts.get(key) ?? { n: 0, newest: s.createdAt };
    steerCounts.set(key, { n: cur.n + 1, newest: s.createdAt > cur.newest ? s.createdAt : cur.newest });
  }
  for (const [note, { n, newest }] of steerCounts) {
    if (n < Math.max(MIN, 3)) continue;
    // Watermark (same rationale as recurring_edit): a resolved steer proposal
    // stays resolved unless the steer keeps happening AFTER it.
    const latest = await prisma.learningSignal.findFirst({
      where: { tenantId: rheos.id, kind: "recurring_steer", proposedText: { contains: note } },
      orderBy: { createdAt: "desc" },
      select: { status: true, createdAt: true },
    });
    if (latest && (latest.status === "open" || newest <= latest.createdAt)) continue;
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
