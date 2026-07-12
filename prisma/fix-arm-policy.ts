/**
 * One-off, idempotent: correct the arm-replacement policy in the Brain to match
 * the real operationalization (confirmed by Jake 2026-07-12): an in-stock arm is
 * ~$6 via a custom invoice; when the arm is out of stock, offer 30% off a new
 * pair. The seeded copy wrongly said "free" / "$10 replacement pair".
 *
 * Touches two entries; re-embeds each. Safe to re-run. Run:
 *   npx tsx prisma/fix-arm-policy.ts
 */
import { prisma } from "../src/lib/db";
import { reindexKnowledgeItem } from "../src/lib/brain/index-write";

const FAQ_TITLE = "Can I get a replacement arm for my sunglasses?";
const FAQ_ANSWER =
  "Yes, when your frame's arm is in stock we can send a replacement. Replacement arms are " +
  "about $6, sent via a custom invoice. To get you the right one, send us the SKU (printed on " +
  "the inside of the left arm), or the style name plus colorway and a photo. We'll also need " +
  "your shipping address for the invoice. If the arm for your pair is out of stock, we'll offer " +
  "30% off a new pair of your choice to make it right.";

const WARRANTY_TITLE = "Warranty coverage — frames, claims, and how we practice it";
const WARRANTY_OLD_LINE =
  "- Replacement arms and parts: when the part is in stock we often ship it free; when the part is no longer available we offer a discounted replacement pair at a $10 fee instead of $20.";
const WARRANTY_NEW_LINE =
  "- Replacement arms and parts: when the arm is in stock, send it for about $6 via a custom invoice (get the SKU from inside the left arm, or the model plus colorway and a photo); when it is out of stock, offer 30% off a new pair.";

async function reembedIfChanged(title: string, nextAnswer: string, tenantId: string) {
  const item = await prisma.knowledgeItem.findFirst({
    where: { tenantId, title },
    select: { id: true, answer: true, version: true },
  });
  if (!item) {
    console.log(`SKIP (not found): "${title}"`);
    return;
  }
  if (item.answer.trim() === nextAnswer.trim()) {
    console.log(`No change: "${title}"`);
    return;
  }
  await prisma.knowledgeItem.update({
    where: { id: item.id },
    data: { answer: nextAnswer, version: { increment: 1 }, sourceRef: "arm policy corrected to $6 / 30%-off 2026-07-12" },
  });
  await prisma.auditEvent.create({
    data: {
      tenantId,
      action: "answer_promoted",
      entity: `knowledge:${item.id}`,
      meta: { title, change: "corrected arm-replacement policy to $6 / 30%-off" },
    },
  });
  await reindexKnowledgeItem(item.id, title, nextAnswer);
  console.log(`Corrected + re-embedded: "${title}" -> v${item.version + 1}`);
}

async function main() {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: "rheos" } });

  // FAQ: full-answer replace.
  await reembedIfChanged(FAQ_TITLE, FAQ_ANSWER, tenant.id);

  // Warranty: swap only the arm/parts bullet, preserving the rest.
  const warranty = await prisma.knowledgeItem.findFirst({
    where: { tenantId: tenant.id, title: WARRANTY_TITLE },
    select: { answer: true },
  });
  if (warranty) {
    if (!warranty.answer.includes(WARRANTY_OLD_LINE) && warranty.answer.includes(WARRANTY_NEW_LINE)) {
      console.log(`No change: "${WARRANTY_TITLE}"`);
    } else if (!warranty.answer.includes(WARRANTY_OLD_LINE)) {
      console.log(`WARN: arm/parts bullet not found verbatim in "${WARRANTY_TITLE}" — left untouched.`);
    } else {
      await reembedIfChanged(WARRANTY_TITLE, warranty.answer.replace(WARRANTY_OLD_LINE, WARRANTY_NEW_LINE), tenant.id);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
