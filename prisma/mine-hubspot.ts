import { PrismaClient } from "@prisma/client";
import Anthropic from "@anthropic-ai/sdk";

/**
 * HubSpot FAQ miner — bootstraps the Brand Brain from real hello@ history.
 *
 * Pull closed conversation threads → extract genuine (customer question, rep reply)
 * pairs → have Claude synthesize a DEDUPLICATED set of canonical FAQ candidates in
 * Rheos voice, skipping topics already covered. Candidates land as status:"draft"
 * KnowledgeItems for a human to approve — the Ledger→Brain promotion, gated.
 *
 * Usage: tsx prisma/mine-hubspot.ts [maxThreads=120]
 */

// idempotent: candidates whose title already exists for the tenant are skipped (and the
// prompt lists existing entries as off-limits), so re-runs never duplicate draft rows.

const CLAUDE_MODEL = "claude-opus-4-8";
const prisma = new PrismaClient();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const HS = process.env.HUBSPOT_TOKEN!;
const MAX_THREADS = Number(process.argv[2] ?? 120);
const MAX_PAIRS = 40;

async function hs<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    headers: { Authorization: `Bearer ${HS}` },
    // 30s socket timeout (hubspot.ts rule) — per-thread failures are already
    // skipped in collectPairs; a listing failure fails the run loudly.
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HubSpot ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

type Thread = { id: string; status: string };
type Message = { type: string; direction?: string; text?: string };
type Pair = { threadId: string; question: string; answer: string };

async function collectPairs(): Promise<Pair[]> {
  const pairs: Pair[] = [];
  let after: string | undefined;
  let scanned = 0;

  while (pairs.length < MAX_PAIRS && scanned < MAX_THREADS) {
    const page = await hs<{ results: Thread[]; paging?: { next?: { after: string } } }>(
      `/conversations/v3/conversations/threads?limit=50${after ? `&after=${after}` : ""}`
    );
    for (const t of page.results) {
      if (scanned >= MAX_THREADS || pairs.length >= MAX_PAIRS) break;
      scanned++;
      try {
        const msgs = await hs<{ results: Message[] }>(
          `/conversations/v3/conversations/threads/${t.id}/messages`
        );
        const real = msgs.results.filter((m) => m.type === "MESSAGE" && (m.text ?? "").trim());
        const firstIn = real.findIndex((m) => m.direction === "INCOMING");
        if (firstIn === -1) continue; // no customer question — likely outbound sales
        const question = real[firstIn].text!.trim();
        const answer = real
          .slice(firstIn + 1)
          .filter((m) => m.direction === "OUTGOING")
          .map((m) => m.text!.trim())
          .slice(0, 2)
          .join("\n\n");
        if (!answer) continue; // no rep reply — nothing to learn
        pairs.push({ threadId: t.id, question: question.slice(0, 800), answer: answer.slice(0, 1200) });
      } catch {
        /* skip a thread that won't load */
      }
    }
    if (!page.paging?.next?.after) break;
    after = page.paging.next.after;
  }
  console.log(`Scanned ${scanned} threads → ${pairs.length} real Q&A pairs.`);
  return pairs;
}

const TOOL = {
  name: "propose_faq",
  description: "Return deduplicated FAQ candidates synthesized from the real exchanges.",
  input_schema: {
    type: "object" as const,
    properties: {
      candidates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "The question or topic." },
            answer: { type: "string", description: "Canonical answer in Rheos voice, from the real replies." },
            triggerPhrases: { type: "array", items: { type: "string" } },
            category: { type: "string" },
            sourceThreadIds: { type: "array", items: { type: "string" } },
          },
          required: ["title", "answer", "triggerPhrases", "category", "sourceThreadIds"],
        },
      },
    },
    required: ["candidates"],
  },
};

async function main() {
  const rheos = await prisma.tenant.findUniqueOrThrow({ where: { slug: "rheos" } });
  const existing = await prisma.knowledgeItem.findMany({
    where: { tenantId: rheos.id },
    select: { title: true },
  });

  const pairs = await collectPairs();
  if (!pairs.length) {
    console.log("No pairs found — nothing to mine.");
    return;
  }

  const transcript = pairs
    .map((p, i) => `#${i + 1} [thread ${p.threadId}]\nCUSTOMER: ${p.question}\nREP: ${p.answer}`)
    .join("\n\n---\n\n");

  const res = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    tools: [TOOL],
    tool_choice: { type: "tool", name: "propose_faq" },
    system:
      "You mine real customer-service exchanges into a clean, deduplicated FAQ. " +
      "Synthesize ONE canonical answer per recurring topic from the actual rep replies, " +
      "in Rheos's warm, conversational voice. Merge duplicates. Skip one-off/sales chatter " +
      "and anything already covered by the existing entries listed. Cite the source threads.",
    messages: [
      {
        role: "user",
        content:
          `Existing Brand Brain entries (do NOT duplicate these):\n` +
          existing.map((e) => `- ${e.title}`).join("\n") +
          `\n\nReal exchanges to mine:\n\n${transcript}`,
      },
    ],
  });

  const call = res.content.find((c) => c.type === "tool_use");
  if (!call || call.type !== "tool_use") {
    console.log("Model returned no candidates.");
    return;
  }
  const { candidates } = call.input as {
    candidates: {
      title: string;
      answer: string;
      triggerPhrases: string[];
      category: string;
      sourceThreadIds: string[];
    }[];
  };

  let created = 0;
  for (const c of candidates) {
    // The prompt-side dedup is soft — guard by title so a re-run can't pile up
    // duplicate draft candidates.
    const dup = await prisma.knowledgeItem.findFirst({
      where: { tenantId: rheos.id, title: c.title },
      select: { id: true },
    });
    if (dup) {
      console.log(`  (skip, title exists) ${c.title}`);
      continue;
    }
    await prisma.knowledgeItem.create({
      data: {
        tenantId: rheos.id,
        kind: "faq",
        title: c.title,
        answer: c.answer,
        triggerPhrases: c.triggerPhrases,
        category: c.category || null,
        status: "draft", // pending human approval before it grounds a reply
        sourceRef: `hubspot: ${c.sourceThreadIds.join(", ")}`,
      },
    });
    created++;
  }

  console.log(`\nProposed ${created} FAQ candidates (status: draft, pending approval):`);
  for (const c of candidates) console.log(`  • [${c.category}] ${c.title}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
