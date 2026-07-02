import { PrismaClient } from "@prisma/client";
import Anthropic from "@anthropic-ai/sdk";
import { hubspot as hs } from "../src/lib/hubspot";

/**
 * Reply-playbook miner — studies HOW the team actually replied across the past
 * 365 days (content moves AND style), category by category, and writes the
 * learnings into the Brand Brain:
 *
 *   - "Reply playbook: <category>" KnowledgeItem per major category — the
 *     content moves (what reps offer/ask/do), specifics repeated across real
 *     replies, style notes, phrases that recur, and what to avoid.
 *   - One voice addendum appended to the tenant voice guide (every draft sees
 *     it) — mined from the best real replies across categories.
 *
 * Samples prefer positive-outcome threads (learn from what worked). Anti-bloat:
 * one entry per category, upserted in place; re-runs refresh rather than grow.
 *
 * Usage: tsx prisma/mine-reply-playbooks.ts
 */

const CLAUDE_MODEL = "claude-opus-4-8";
const prisma = new PrismaClient();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 300_000, maxRetries: 2 });


const CATEGORIES = [
  "warranty",
  "replacement_parts",
  "shipping_order_status",
  "returns_exchange",
  "product_question",
  "wholesale",
  "sizing_fit",
] as const;


type Message = { type: string; direction?: string; text?: string };

/** First customer message + up to two rep replies from a thread. */
async function exchange(threadId: string): Promise<{ customer: string; reps: string[] } | null> {
  const msgs = await hs<{ results: Message[] }>(`/conversations/v3/conversations/threads/${threadId}/messages?limit=100`);
  const real = msgs.results.filter((m) => m.type === "MESSAGE" && (m.text ?? "").trim());
  const firstIn = real.find((m) => m.direction === "INCOMING");
  const reps = real.filter((m) => m.direction === "OUTGOING").map((m) => m.text!.trim());
  if (!firstIn || !reps.length) return null;
  return { customer: firstIn.text!.trim().slice(0, 600), reps: reps.slice(0, 2).map((r) => r.slice(0, 900)) };
}

const PLAYBOOK_TOOL = {
  name: "write_playbook",
  description: "Distill the real exchanges into a reply playbook.",
  input_schema: {
    type: "object" as const,
    properties: {
      playbook: {
        type: "string",
        description:
          "The playbook, compact (under 220 words): the content moves reps make (what they offer, " +
          "ask for, and do next), any specifics (fees, timeframes, processes) ONLY if they recur " +
          "across multiple replies, then 2-3 style notes and recurring phrases. End with 1-2 avoid notes if visible.",
      },
      triggerPhrases: { type: "array", items: { type: "string" } },
    },
    required: ["playbook", "triggerPhrases"],
  },
};

async function main() {
  const rheos = await prisma.tenant.findUniqueOrThrow({ where: { slug: "rheos" } });
  const allBestReplies: string[] = [];

  for (const cat of CATEGORIES) {
    // Prefer positive endings, top up with neutral — learn from what worked.
    const pos = await prisma.analyticsInquiry.findMany({
      where: { tenantId: rheos.id, category: cat, endSentiment: "positive" },
      orderBy: { threadCreatedAt: "desc" },
      take: 14,
      select: { threadId: true },
    });
    const neu = await prisma.analyticsInquiry.findMany({
      where: { tenantId: rheos.id, category: cat, endSentiment: "neutral" },
      orderBy: { threadCreatedAt: "desc" },
      take: Math.max(0, 18 - pos.length),
      select: { threadId: true },
    });

    const exchanges: { customer: string; reps: string[] }[] = [];
    for (const t of [...pos, ...neu]) {
      try {
        const e = await exchange(t.threadId);
        if (e) exchanges.push(e);
      } catch {
        /* skip */
      }
      await new Promise((r) => setTimeout(r, 130));
      if (exchanges.length >= 14) break;
    }
    if (exchanges.length < 4) {
      console.log(`  ${cat}: only ${exchanges.length} usable exchanges — skipped`);
      continue;
    }
    allBestReplies.push(...exchanges.slice(0, 4).flatMap((e) => e.reps.slice(0, 1)));

    const transcript = exchanges
      .map((e, i) => `#${i + 1}\nCUSTOMER: ${e.customer}\nREP REPLY: ${e.reps.join("\n---next rep reply---\n")}`)
      .join("\n\n====\n\n");

    const res = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      tools: [PLAYBOOK_TOOL],
      tool_choice: { type: "tool", name: "write_playbook" },
      system:
        `You are distilling how Rheos (floating sunglasses) customer service ACTUALLY handles "${cat}" ` +
        `inquiries, from real exchanges that ended well. Extract the recurring content moves and style. ` +
        `Include concrete specifics (fees, windows, steps) ONLY when they appear in multiple replies — ` +
        `never generalize from a single instance. This grounds future AI drafts, so accuracy beats completeness.`,
      messages: [{ role: "user", content: transcript }],
    });
    const call = res.content.find((c) => c.type === "tool_use");
    if (!call || call.type !== "tool_use") continue;
    const out = call.input as { playbook: string; triggerPhrases: string[] };

    const title = `Reply playbook: ${cat.replace(/_/g, " ")}`;
    const existing = await prisma.knowledgeItem.findFirst({
      where: { tenantId: rheos.id, title },
      select: { id: true, version: true },
    });
    if (existing) {
      await prisma.knowledgeItem.update({
        where: { id: existing.id },
        data: { answer: out.playbook, triggerPhrases: out.triggerPhrases, version: existing.version + 1, embedding: undefined },
      });
    } else {
      await prisma.knowledgeItem.create({
        data: {
          tenantId: rheos.id,
          kind: "script",
          title,
          answer: out.playbook,
          triggerPhrases: out.triggerPhrases,
          tags: ["playbook", cat],
          category: "Reply Playbooks",
          status: "approved",
          sourceRef: `mined from ${exchanges.length} real ${cat} exchanges (365d, positive-first)`,
        },
      });
    }
    console.log(`  ${cat}: playbook written from ${exchanges.length} exchanges`);
  }

  // Voice addendum from the best replies across categories — appended once.
  const MARKER = "— Mined from real replies (365d) —";
  if (allBestReplies.length >= 8 && !(rheos.voiceGuide ?? "").includes(MARKER)) {
    const res = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 600,
      system:
        "Distill HOW this support team actually writes, from real replies. Output 6-9 tight rules " +
        "(greeting style, sign-off, sentence rhythm, how they deliver bad news, recurring phrases). " +
        "Plain lines, no preamble.",
      messages: [{ role: "user", content: allBestReplies.slice(0, 24).join("\n\n---\n\n") }],
    });
    const text = res.content.map((c) => (c.type === "text" ? c.text : "")).join("").trim();
    await prisma.tenant.update({
      where: { id: rheos.id },
      data: { voiceGuide: `${rheos.voiceGuide ?? ""}\n\n${MARKER}\n${text}`.trim() },
    });
    console.log(`  voice addendum appended (${text.length} chars)`);
  }

  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
