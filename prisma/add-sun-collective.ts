/**
 * One-off, idempotent: seed/refresh the authoritative "Sun Collective
 * membership" Brain entry so the AI describes the membership accurately.
 *
 * Facts derived from the REAL implementation in Birdseye (rheos-inventory):
 *   src/lib/sun-collective-perks.ts   — MEMBER_PRICE_LABEL "$5/month", perks
 *   src/app/api/sun-collective/checkout/route.ts — applies value:50 PERCENTAGE
 *   src/app/(public)/sun-collective/page.tsx      — SUBSCRIPTION_URL
 * Verified 2026-07-12. Keep in sync with sun-collective-perks.ts if the
 * offer changes.
 *
 * Mirrors the manager-authored write path (create approved + reindex inline).
 * Safe to re-run. Run:  npx tsx prisma/add-sun-collective.ts
 */
import { prisma } from "../src/lib/db";
import { reindexKnowledgeItem } from "../src/lib/brain/index-write";

const TITLE = "Sun Collective membership";
const CATEGORY = "Membership";
const SOURCE_REF = "birdseye sun-collective-perks.ts (code-verified 2026-07-12)";
const JOIN_URL = "https://www.rheosgear.com/products/sun-collective-1m";

// No em dashes anywhere — customer replies may quote this verbatim.
const ANSWER = [
  "Sun Collective is our direct-to-consumer membership. It is $5 a month and can be cancelled anytime. Members get:",
  "- 50% off every Rheos pair, for as long as they stay a member (applied automatically at checkout in the member shop).",
  "- A free premium travel case with their first order.",
  "- A 2-year VIP warranty, double the standard coverage.",
  "- Early access to new drops and member-only colorways.",
  "",
  `How to join: subscribe at ${JOIN_URL} (set up on rheosgear.com, billed monthly through Recharge). Existing members sign in to the member shop at https://birdseye.scribechs.com/sun-collective.`,
  "",
  "When to mention it: it is a natural fit for customers handling an exchange, warranty, or replacement, or anyone asking about deals or buying more pairs. Offer it as a helpful heads-up, not a hard sell, and never on wholesale or dealer inquiries.",
].join("\n");

const TRIGGERS = [
  "sun collective", "membership", "member", "members", "subscribe", "subscription",
  "join", "vip", "50% off", "member price", "member discount", "loyalty",
  "monthly", "$5 a month", "travel case",
];

async function main() {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: "rheos" } });
  const existing = await prisma.knowledgeItem.findFirst({
    where: { tenantId: tenant.id, title: TITLE },
    select: { id: true, answer: true, version: true },
  });

  let id: string;
  if (existing) {
    const changed = existing.answer.trim() !== ANSWER.trim();
    const updated = await prisma.knowledgeItem.update({
      where: { id: existing.id },
      data: {
        answer: ANSWER,
        category: CATEGORY,
        triggerPhrases: TRIGGERS,
        status: "approved",
        sourceRef: SOURCE_REF,
        ...(changed ? { version: { increment: 1 } } : {}),
      },
    });
    id = updated.id;
    console.log(`Updated "${TITLE}" (${id})${changed ? ` -> v${existing.version + 1}` : " (no answer change)"}`);
  } else {
    const created = await prisma.knowledgeItem.create({
      data: {
        tenantId: tenant.id,
        kind: "faq",
        title: TITLE,
        answer: ANSWER,
        category: CATEGORY,
        triggerPhrases: TRIGGERS,
        tags: [],
        status: "approved",
        sourceRef: SOURCE_REF,
      },
    });
    id = created.id;
    console.log(`Created "${TITLE}" (${id})`);
  }

  await prisma.auditEvent.create({
    data: {
      tenantId: tenant.id,
      action: "answer_promoted",
      entity: `knowledge:${id}`,
      meta: { title: TITLE, source: SOURCE_REF },
    },
  });

  await reindexKnowledgeItem(id, TITLE, ANSWER);
  console.log("Embedded (semantic retrieval live).");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
