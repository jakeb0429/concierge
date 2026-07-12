/**
 * One-off, idempotent: seed/refresh the "Current discount codes" Brain entry
 * so the AI can offer live consumer promo codes where appropriate.
 *
 * Codes verified against Shopify order redemptions + confirmed by Jake
 * (2026-07-12): both evergreen (no expiry). TAKE20 was intentionally left
 * out — it is cancelled.
 *
 * Mirrors the manager-authored write path (create approved + reindex inline).
 * Safe to re-run: upserts by (tenantId, title) and only bumps version when
 * the answer changed. Run:  npx tsx prisma/add-discount-codes.ts
 */
import { prisma } from "../src/lib/db";
import { reindexKnowledgeItem } from "../src/lib/brain/index-write";

const TITLE = "Current discount codes";
const CATEGORY = "Promotions";
const SOURCE_REF = "ops: Shopify-verified + Jake-confirmed 2026-07-12";

// No em dashes anywhere — customer replies may quote this verbatim.
const ANSWER = [
  "Two evergreen consumer discount codes are live on rheosgear.com (entered at checkout, no expiration):",
  "- SUNNYDAYS: 15% off the order.",
  "- 2FOR100: two pairs of sunglasses for $100 (a $30 saving on two pairs).",
  "",
  "When to offer: share a code where it fits naturally, such as when the customer asks about discounts, mentions price, is a first-time buyer, or as a goodwill gesture on a service issue. Do not add a code to every reply, and do not offer more than one code in the same message.",
  "These are direct-to-consumer promos only. Never offer them on wholesale, dealer, or purchase-order inquiries, which have their own pricing.",
].join("\n");

const TRIGGERS = [
  "discount", "discount code", "promo", "promo code", "coupon", "coupon code",
  "code", "sale", "deal", "cheaper", "price", "first order", "any codes",
  "savings", "sunnydays", "2for100", "two for", "2 for 100",
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
