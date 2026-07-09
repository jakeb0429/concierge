import { PrismaClient } from "@prisma/client";
import Anthropic from "@anthropic-ai/sdk";
import { hubspot as hs } from "../src/lib/hubspot";

/**
 * Analytics backfill — classifies the past 365 days of hello@ conversations
 * (HubSpot threads) into AnalyticsInquiry rows: category + how the exchange
 * ended. End-sentiment is judged from the TAIL of the thread (both sides of
 * the last few exchanges), not just the customer's last message — a thread
 * where the rep answered last is resolved, not "unresolved".
 *
 * One-time and resume-safe: already-imported threadIds are skipped, so it can
 * be re-run after interruption or on a schedule to pick up new threads.
 * Usage: tsx prisma/analytics-backfill.ts [maxThreads]
 *        tsx prisma/analytics-backfill.ts --reclassify [sentiment] [maxRows]
 *          re-judges endSentiment on existing rows (default: unresolved —
 *          the bucket the old last-customer-message-only prompt inflated).
 *          Categories and product enrichment are left untouched.
 */

// idempotent: already-imported threadIds are skipped up front and rows upsert by unique
// threadId; --reclassify only rewrites endSentiment in place (no rows added or doubled).

const prisma = new PrismaClient();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 120_000, maxRetries: 2 });

const TRIAGE_MODEL = "claude-haiku-4-5-20251001";
const RECLASSIFY = process.argv[2] === "--reclassify";
const RECLASSIFY_SENTIMENT = RECLASSIFY ? (process.argv[3] ?? "unresolved") : null;
const MAX = RECLASSIFY ? Infinity : Number(process.argv[2] ?? 10_000);
const CUTOFF = new Date(Date.now() - 365 * 24 * 3600 * 1000);


type Thread = { id: string; createdAt: string };
type Message = {
  type: string;
  createdAt?: string;
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
  tail: string; // last few messages, BOTH directions, labeled + in order
  lastFrom: "CUSTOMER" | "RHEOS REP";
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
                "How the exchange ENDED for the customer, judged from the customer's final " +
                "reply or replies IN CONTEXT of the thread tail: positive (thanked/satisfied), " +
                "negative (frustrated/unhappy), neutral. Use unresolved ONLY when the customer's " +
                "last message still asks for or needs something and no rep reply follows it. " +
                "If the rep answered the customer's last message and the customer simply didn't " +
                "reply again, that is resolved — neutral (or positive/negative if the customer's " +
                "earlier replies expressed satisfaction/frustration), NOT unresolved.",
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
        `END OF THREAD (oldest first, final message last — final message is from ${e.lastFrom}):\n${e.tail}`
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

/** Fetch a thread's messages and build the classifier input. Null = no usable customer message. */
async function buildExtract(threadId: string, createdAt: Date): Promise<Extract | null> {
  const msgs = await hs<{ results: Message[] }>(
    `/conversations/v3/conversations/threads/${threadId}/messages?limit=100`
  );
  // HubSpot returns messages NEWEST-first — sort oldest-first explicitly, or the
  // "thread tail" is actually the thread start (the bug that skewed sentiment).
  const real = msgs.results
    .filter((m) => m.type === "MESSAGE" && (m.text ?? "").trim())
    .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
  const inbound = real.filter((m) => m.direction === "INCOMING");
  if (!inbound.length) return null; // outbound-only thread
  const sender = inbound[0].senders?.find((s) => s.deliveryIdentifier?.type === "HS_EMAIL_ADDRESS");
  const tailMsgs = real.slice(-6);
  const label = (m: Message) => (m.direction === "INCOMING" ? "CUSTOMER" : "RHEOS REP");
  return {
    threadId,
    createdAt,
    fromEmail: sender?.deliveryIdentifier?.value?.toLowerCase() ?? null,
    subject: null,
    firstMsg: inbound[0].text!,
    tail: tailMsgs.map((m) => `${label(m)}: ${m.text!.slice(0, 300)}`).join("\n"),
    lastFrom: label(tailMsgs[tailMsgs.length - 1]),
  };
}

/**
 * Re-judge endSentiment on already-imported rows with the tail-aware prompt.
 * Only endSentiment is updated — category and product enrichment stay put.
 */
async function reclassify(sentiment: string) {
  const maxRows = Number(process.argv[4] ?? Infinity);
  const rows = (
    await prisma.analyticsInquiry.findMany({
      where: { source: "hubspot", ...(sentiment === "all" ? {} : { endSentiment: sentiment }) },
      select: { id: true, threadId: true, threadCreatedAt: true, endSentiment: true },
      orderBy: { threadCreatedAt: "asc" },
    })
  ).slice(0, maxRows);
  console.log(`Reclassifying ${rows.length} "${sentiment}" rows with full-thread context…`);

  let pending: { row: (typeof rows)[number]; ex: Extract }[] = [];
  let done = 0;
  const shifts = new Map<string, number>();
  const flush = async () => {
    if (!pending.length) return;
    const VALID = new Set(["positive", "neutral", "negative", "unresolved"]);
    const cls = await classifyBatch(pending.map((p) => p.ex));
    for (let i = 0; i < pending.length; i++) {
      const prev = pending[i].row.endSentiment;
      const next = cls.get(i)?.endSentiment;
      // The tool enum is not enforced server-side — one sweep returned "resolved".
      if (next && VALID.has(next) && next !== prev) {
        await prisma.analyticsInquiry.update({
          where: { id: pending[i].row.id },
          data: { endSentiment: next },
        });
        shifts.set(`${prev}→${next}`, (shifts.get(`${prev}→${next}`) ?? 0) + 1);
      }
      done++;
    }
    console.log(
      `  [${new Date().toISOString().slice(11, 19)}] ${done}/${rows.length} — moved: ` +
        ([...shifts].map(([k, v]) => `${k} ${v}`).join(", ") || "none yet")
    );
    pending = [];
  };

  for (const row of rows) {
    try {
      const ex = await buildExtract(row.threadId, row.threadCreatedAt);
      if (ex) pending.push({ row, ex });
      if (pending.length >= 20) await flush();
      await new Promise((r) => setTimeout(r, 120)); // ~8 req/s, under HubSpot burst limits
    } catch (e) {
      console.error(`  thread ${row.threadId} skipped:`, (e as Error).message.slice(0, 80));
    }
  }
  await flush();
  const moved = [...shifts.values()].reduce((a, b) => a + b, 0);
  console.log(`Reclassify done. ${done} judged: unchanged ${done - moved}, moved ${moved} (` +
    [...shifts].map(([k, v]) => `${k} ${v}`).join(", ") + ")");
}

async function main() {
  if (RECLASSIFY) return reclassify(RECLASSIFY_SENTIMENT!);
  const rheos = await prisma.tenant.findUniqueOrThrow({ where: { slug: "rheos" } });
  const have = new Set(
    (await prisma.analyticsInquiry.findMany({ select: { threadId: true } })).map((r) => r.threadId)
  );
  console.log(`Backfill starting. Already imported: ${have.size}. Cutoff: ${CUTOFF.toISOString().slice(0, 10)}`);

  // 1. Page all threads, keep those in the last 365 days and not yet imported.
  const threads: Thread[] = [];
  const seen = new Set<string>();
  let pages = 0;
  let noNew = 0;
  let after = "";
  while (threads.length < MAX) {
    const page = await hs<{ results: Thread[]; paging?: { next?: { after: string } } }>(
      `/conversations/v3/conversations/threads?limit=100${after ? `&after=${after}` : ""}`
    );
    let added = 0;
    for (const t of page.results) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      added++;
      if (new Date(t.createdAt) >= CUTOFF && !have.has(t.id)) threads.push(t);
    }
    // HubSpot keeps issuing next-cursors past the real end — break when pages
    // stop contributing unseen threads.
    noNew = added === 0 ? noNew + 1 : 0;
    if (noNew >= 3 || pages > 120) break;
    if (!page.paging?.next?.after) break;
    after = page.paging.next.after;
    pages++;
    if (pages % 10 === 0) console.log(`  [${new Date().toISOString().slice(11, 19)}] page ${pages} — ${threads.length} in-window`);
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
    console.log(`  [${new Date().toISOString().slice(11, 19)}] imported ${imported}/${threads.length}`);
    pending = [];
  };

  for (const t of threads) {
    try {
      const ex = await buildExtract(t.id, new Date(t.createdAt));
      if (ex) pending.push(ex);
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
