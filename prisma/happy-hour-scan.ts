import { PrismaClient } from "@prisma/client";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, CLAUDE_MODEL } from "../src/lib/anthropic";
import { parseSpecials } from "../src/lib/happy-hour";

/**
 * Happy-hour scan — Charleston & Mount Pleasant, for the digest's morning
 * widget. Claude + web search hunts for freshly ANNOUNCED deals (restaurant
 * Instagram/Facebook posts, local food press — the motivating example: The
 * Grocery announcing a $5 martini and half-off appetizers) plus the standing
 * weekly happy hours worth knowing, then upserts them into HappyHourSpecial.
 *
 * Idempotent: rows key on dedupeKey (normalized venue|deal); a re-run
 * re-stamps lastSeenAt on deals it sees again and inserts only what's new.
 * Fail-soft: no API key, a refused/empty response, or unparseable output
 * logs and exits — yesterday's rows keep the widget alive.
 *
 * Usage: tsx prisma/happy-hour-scan.ts
 * Cron:  daily 10:15 UTC (~6am ET), ahead of the 11:00 UTC digest email.
 */

const prisma = new PrismaClient();

const WEB_SEARCH_TOOL = {
  type: "web_search_20260209",
  name: "web_search",
  max_uses: 8,
  user_location: {
    type: "approximate",
    city: "Charleston",
    region: "South Carolina",
    country: "US",
    timezone: "America/New_York",
  },
} as const;

const SYSTEM = `You are a local scout for a small Charleston, SC team. Each morning you find happy hour deals in Charleston and Mount Pleasant, South Carolina.

Two kinds of finds, in priority order:
1. "special" — a FRESHLY ANNOUNCED or limited-time deal: a restaurant or bar just posted it (Instagram, Facebook, their site) or local food press just covered it. Example of exactly what we want: The Grocery announcing a $5 martini and half off some of their appetizers.
2. "recurring" — a standing weekly happy hour at a well-regarded spot (e.g. weekday 4-7pm oyster + drink deals).

Rules:
- Only include deals you found actual evidence for in your searches. Never invent a venue, price, or schedule. Skip anything you cannot source.
- Only venues in Charleston proper or Mount Pleasant, SC.
- Prefer this week's announcements and currently-running deals.

End your reply with EXACTLY ONE fenced json block (and no other fenced blocks) shaped like:
\`\`\`json
{"specials": [{"venue": "The Grocery", "area": "Charleston", "deal": "$5 martinis", "details": "plus half off select appetizers, Mon-Fri 4-6pm", "kind": "special", "source": "Instagram @thegrocerychs", "sourceUrl": "https://..."}]}
\`\`\`
Fields: venue (name only), area ("Charleston" or "Mount Pleasant"), deal (short — the headline offer), details (schedule/fine print, optional), kind ("special" or "recurring"), source (where you saw it, optional), sourceUrl (optional). Up to 10 entries; an empty list is a valid answer.`;

const REQUEST_OPTS = { timeout: 240_000, maxRetries: 2 }; // bounded — never hang the cron

async function runScan(): Promise<string | null> {
  const today = new Date().toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  let messages: Anthropic.MessageParam[] = [
    { role: "user", content: `Today is ${today}. Find current happy hour deals and fresh specials in Charleston and Mount Pleasant, SC.` },
  ];

  const create = () =>
    anthropic.messages.create(
      {
        model: CLAUDE_MODEL,
        max_tokens: 4000,
        thinking: { type: "adaptive" },
        system: SYSTEM,
        tools: [WEB_SEARCH_TOOL as unknown as Anthropic.Messages.ToolUnion],
        messages,
      },
      REQUEST_OPTS
    );

  let res = await create();
  // Server-side tool loops can pause; resume by echoing the assistant turn.
  for (let hop = 0; res.stop_reason === "pause_turn" && hop < 6; hop++) {
    messages = [...messages, { role: "assistant", content: res.content }];
    res = await create();
  }
  if (res.stop_reason === "refusal") {
    console.error("happy-hour-scan: model refused the request");
    return null;
  }
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("happy-hour-scan: ANTHROPIC_API_KEY missing — skipped");
    return;
  }

  const text = await runScan();
  if (!text) return;

  const specials = parseSpecials(text);
  if (!specials.length) {
    console.log("happy-hour-scan: no parseable deals in the model output — existing rows stand");
    return;
  }

  const now = new Date();
  let created = 0;
  let refreshed = 0;
  for (const s of specials) {
    const existing = await prisma.happyHourSpecial.findUnique({ where: { dedupeKey: s.dedupeKey } });
    await prisma.happyHourSpecial.upsert({
      where: { dedupeKey: s.dedupeKey },
      create: { ...s, lastSeenAt: now },
      update: {
        area: s.area,
        details: s.details,
        kind: s.kind,
        source: s.source,
        sourceUrl: s.sourceUrl,
        lastSeenAt: now,
      },
    });
    if (existing) refreshed++;
    else created++;
    console.log(`  ${existing ? "seen again" : "NEW"} [${s.kind}] ${s.venue} (${s.area}): ${s.deal}`);
  }
  console.log(`happy-hour-scan: ${created} new, ${refreshed} re-stamped (${specials.length} total)`);
}

main()
  .catch((err) => {
    console.error("happy-hour-scan failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
