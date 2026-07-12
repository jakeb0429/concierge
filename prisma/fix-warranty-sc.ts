/**
 * One-off, idempotent: correct the stale Sun Collective bullet in the
 * warranty Brain entry so it matches the REAL member offer.
 *
 * The old bullet claimed "$5 flat-rate repairs" + "30% off the Oops
 * Replacement Program" + "accidental damage" — none of which exist in the
 * Birdseye code (sun-collective-perks.ts). The real member warranty perk is a
 * 2-year VIP warranty (double the standard 1-year), plus 50% off any pair in
 * the member shop. Jake authorized this correction 2026-07-12.
 *
 * Only the Sun Collective line is rewritten; the rest of the warranty policy
 * is untouched. Safe to re-run. Run:  npx tsx prisma/fix-warranty-sc.ts
 */
import { prisma } from "../src/lib/db";
import { reindexKnowledgeItem } from "../src/lib/brain/index-write";

const TITLE = "Warranty coverage — frames, claims, and how we practice it";

const NEW_SC_LINE =
  "- Sun Collective VIP members ($5/month) get a 2-year VIP warranty, double the standard " +
  "one-year coverage, and can replace any pair at 50% off in the member shop. See the Sun " +
  "Collective membership entry for the full perks and the join link.";

async function main() {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: "rheos" } });
  const item = await prisma.knowledgeItem.findFirst({
    where: { tenantId: tenant.id, title: TITLE },
    select: { id: true, answer: true, version: true },
  });
  if (!item) throw new Error(`Warranty entry not found: "${TITLE}"`);

  // Replace the single Sun Collective bullet (from its marker to end of line).
  const rewritten = item.answer.replace(/^- Sun Collective VIP members.*$/m, NEW_SC_LINE);

  if (!/^- Sun Collective VIP members/m.test(item.answer)) {
    throw new Error("No Sun Collective bullet found to replace — aborting (nothing changed).");
  }
  if (rewritten === item.answer) {
    console.log("No change needed (already corrected).");
    return;
  }

  await prisma.knowledgeItem.update({
    where: { id: item.id },
    data: { answer: rewritten, version: { increment: 1 }, sourceRef: "SC bullet corrected to code-verified offer 2026-07-12" },
  });
  await prisma.auditEvent.create({
    data: {
      tenantId: tenant.id,
      action: "answer_promoted",
      entity: `knowledge:${item.id}`,
      meta: { title: TITLE, change: "corrected stale Sun Collective perks to real offer" },
    },
  });
  await reindexKnowledgeItem(item.id, TITLE, rewritten);
  console.log(`Corrected Sun Collective bullet in "${TITLE}" -> v${item.version + 1}, re-embedded.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
