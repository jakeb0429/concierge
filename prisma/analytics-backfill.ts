import { PrismaClient } from "@prisma/client";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Analytics backfill — classifies the past 365 days of hello@ conversations
 * (HubSpot threads) into AnalyticsInquiry rows: category + how the exchange
 * ended (sentiment of the customer's last message).
 *
 * One-time and resume-safe: already-imported threadIds are skipped, so it can
 * be re-run after interruption or on a schedule to pick up new threads.
 * Usage: tsx prisma/analytics-backfill.ts [maxThreads]
 */

const prisma = new PrismaClient();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const HS = process.env.HUBSPOT_TOKEN!;
const TRIAGE_MODEL = "claude-haiku-4-5-20251001";
const MAX = Number(process.argv[2] ?? 10_000);
const CUTOFF = new Date(Date.now() - 365 * 24 * 3600 * 1000);

async function hs<T>(path: string, attempt = 0): Promise<T> {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    headers: { Authorization: `Bearer ${HS}` },
    signal: AbortSignal.timeout(30_000), // a hung socket must not stall the whole backfill
  }).catch((e) => {
    if (attempt < 6) return null;
    throw e;
  });
  if (!res) {
    await new Promise((r) => setTimeout(r, 3_000));
    return hs(path, attempt + 1);
  }
  if (res.status === 429 && attempt < 6) {
    await new Promise((r) => setTimeout(r, 11_000));
    return hs(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`HubSpot ${res.status} on ${path}`);
  return res.json() as Promise<T>;
}

type Thread = { id: string; createdAt: string };
type Message = {
  type: string;
  direction?: string;
  text?: string;
  senders?: { deliveryIdentifier?: { type: string; value: string } }[];
};

type Extract = {
  threadId: string;
  createdAt: Date;
  fromEmail: string | null;
  subject: string | null;
  firstMsg: string;
  lastMsg: string;
};

const CLASSIFY_TOOL = {
  name: "classify_batch",
  description: "Classify each numbered support conversation.",
  input_schema: {
    type: "object" as const,
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            n: { type: "number", description: "The conversation number." },
            category: {
              type: "string",
              enum: [
                "warranty",
                "replacement_parts",
                "shipping_order_status",
                "returns_exchange",
                "product_question",
                "sizing_fit",
                "wholesale",
                "vendor_pitch",
                "marketing_collab",
                "automated_notification",
                "other",
              ],
            },
            endSentiment: {
              type: "string",
              enum: ["positive", "neutral", "negative", "unresolved"],
              description:
                "How the exchange ENDED for the customer, judged from their last message: " +
                "positive (thanked/satisfied), negative (frustrated/unhappy), neutral, " +
                "or unresolved (question hanging with no rep resolution visible).",
            },
          },
          required: ["n", "category", "endSentiment"],
        },
      },
    },
    required: ["results"],
  },
};

async function classifyBatch(batch: Extract[]): Promise<Map<number, { category: string; endSentiment: string }>> {
  const prompt = batch
    .map(
      (e, i) =>
        `#${i + 1} [${e.createdAt.toISOString().slice(0, 10)}] subject: ${e.subject ?? "(none)"}\n` +
        `FIRST customer message: ${e.firstMsg.slice(0, 500)}\n` +
        `LAST customer message: ${e.lastMsg.slice(0, 400)}`
    )
    .join("\n\n---\n\n");
  const res = await anthropic.messages.create({
    model: TRIAGE_MODEL,
    max_tokens: 2048,
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: "tool", name: "classify_batch" },
    system:
      "You classify support conversations for Rheos, a floating-sunglasses brand. " +
      "warranty = broken/scratched/defective product claims. replacement_parts = arms/lenses/parts requests. " +
      "shipping_order_status = where's-my-order, address changes, tracking. returns_exchange = refunds/exchanges. " +
      "product_question = pre-purchase questions (features, recommendations). sizing_fit = fit/size questions. " +
      "wholesale = dealers/shops asking to stock or order in bulk. vendor_pitch = someone selling TO Rheos. " +
      "marketing_collab = influencers/ambassadors/sponsorship asks. automated_notification = machine mail.",
    messages: [{ role: "user", content: prompt }],
  });
  const call = res.content.find((c) => c.type === "tool_use");
  const out = new Map<number, { category: string; endSentiment: string }>();
  if (call && call.type === "tool_use") {
    for (const r of (call.input as { results: { n: number; category: string; endSentiment: string }[] }).results) {
      out.set(r.n - 1, { category: r.category, endSentiment: r.endSentiment });
    }
  }
  return out;
}

async function main() {
  const rheos = await prisma.tenant.findUniqueOrThrow({ where: { slug: "rheos" } });
  const have = new Set(
    (await prisma.analyticsInquiry.findMany({ select: { threadId: true } })).map((r) => r.threadId)
  );
  console.log(`Backfill starting. Already imported: ${have.size}. Cutoff: ${CUTOFF.toISOString().slice(0, 10)}`);

  // 1. Page all threads, keep those in the last 365 days and not yet imported.
  const threads: Thread[] = [];
  let after = "";
  while (threads.length < MAX) {
    const page = await hs<{ results: Thread[]; paging?: { next?: { after: string } } }>(
      `/conversations/v3/conversations/threads?limit=100${after ? `&after=${after}` : ""}`
    );
    for (const t of page.results) {
      if (new Date(t.createdAt) >= CUTOFF && !have.has(t.id)) threads.push(t);
    }
    if (!page.paging?.next?.after) break;
    after = page.paging.next.after;
    if (threads.length % 500 < 100) console.log(`  paging… ${threads.length} in-window so far`);
  }
  console.log(`Threads to process: ${threads.length}`);

  // 2. Fetch messages per thread (rate-limit friendly), extract, classify in batches of 20.
  let pending: Extract[] = [];
  let imported = 0;
  const flush = async () => {
    if (!pending.length) return;
    const cls = await classifyBatch(pending);
    for (let i = 0; i < pending.length; i++) {
      const e = pending[i];
      const c = cls.get(i) ?? { category: "other", endSentiment: "neutral" };
      await prisma.analyticsInquiry.upsert({
        where: { threadId: e.threadId },
        update: {},
        create: {
          tenantId: rheos.id,
          source: "hubspot",
          threadId: e.threadId,
          fromEmail: e.fromEmail,
          subject: e.subject,
          category: c.category,
          endSentiment: c.endSentiment,
          threadCreatedAt: e.createdAt,
        },
      });
      imported++;
    }
    console.log(`  imported ${imported}/${threads.length}`);
    pending = [];
  };

  for (const t of threads) {
    try {
      const msgs = await hs<{ results: Message[] }>(
        `/conversations/v3/conversations/threads/${t.id}/messages?limit=100`
      );
      const real = msgs.results.filter((m) => m.type === "MESSAGE" && (m.text ?? "").trim());
      const inbound = real.filter((m) => m.direction === "INCOMING");
      if (!inbound.length) continue; // outbound-only thread
      const sender = inbound[0].senders?.find((s) => s.deliveryIdentifier?.type === "HS_EMAIL_ADDRESS");
      pending.push({
        threadId: t.id,
        createdAt: new Date(t.createdAt),
        fromEmail: sender?.deliveryIdentifier?.value?.toLowerCase() ?? null,
        subject: null,
        firstMsg: inbound[0].text!,
        lastMsg: inbound[inbound.length - 1].text!,
      });
      if (pending.length >= 20) await flush();
      await new Promise((r) => setTimeout(r, 120)); // ~8 req/s, under HubSpot burst limits
    } catch (e) {
      console.error(`  thread ${t.id} skipped:`, (e as Error).message.slice(0, 80));
    }
  }
  await flush();
  console.log(`Done. ${imported} inquiries imported this run.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
