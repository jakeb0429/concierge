import { PrismaClient } from "@prisma/client";

/**
 * Stingray Brand Brain — factory service reps & territories, so drafts can
 * tell an owner who their regional rep is and route dealer questions right.
 * Mirrors DealersCircle zone config (full rules:
 * stingray-reports/docs/territory-rep-rules.md; runtime resolution lives in
 * src/lib/territories.ts and feeds draft context automatically).
 *
 * Idempotent: upserts by (tenant, title); a changed answer clears the
 * embedding so db:embed re-indexes it.
 * Usage: npx tsx prisma/seed-stingray-reps.ts
 */

const prisma = new PrismaClient();

const ANSWER = [
  "Stingray covers North America with five regional factory service reps, each owning a territory of dealers:",
  "• Northeast (New England, NY, NJ, PA, DE, most of MD/VA, eastern Canada) — Jason Martin",
  "• Carolinas (NC, SC, WV, Augusta/Savannah-side GA, southwest VA) — Chad Fink",
  "• Southeast (FL, AL, metro-Atlanta GA, coastal MS, Puerto Rico) — Chandler French",
  "• Midwest (Great Lakes states, KY, OH, plains states, Ontario) — Rick Pumphrey",
  "• Central (TX, OK, LA, AR, most of TN/MN/MO) — Clayton Wheeler",
  "House accounts (Chatlee Sporting Goods, Master Marine, Freedom Marine boat clubs, Extreme Performance) are handled by Gail Kimbrell.",
  "A customer's rep follows their DEALER's territory; when only the customer's address is known, the delivery state (and zip in border states) decides.",
  "International/overseas customers have no zone rep — route to the factory directly.",
  "Do NOT promise a rep will call — offer to loop in the regional rep and let the team confirm.",
].join("\n");

async function main() {
  const stingray = await prisma.tenant.findUniqueOrThrow({ where: { slug: "stingray" } });
  const item = {
    kind: "policy",
    title: "Factory service reps & territories",
    answer: ANSWER,
    triggerPhrases: [
      "who is my rep",
      "service rep",
      "sales rep",
      "regional rep",
      "territory",
      "who covers my area",
      "factory contact",
    ],
    tags: ["rep", "territory", "zone", "regional", "support"],
    category: "support",
    sourceRef: "DealersCircle zone config · stingray-reports/docs/territory-rep-rules.md",
  };
  const existing = await prisma.knowledgeItem.findFirst({
    where: { tenantId: stingray.id, title: item.title },
    select: { id: true, answer: true },
  });
  if (existing) {
    if (existing.answer !== item.answer) {
      await prisma.knowledgeItem.update({
        where: { id: existing.id },
        data: { ...item, status: "approved", version: { increment: 1 }, embedding: null as never },
      });
      console.log("updated (embedding cleared — run db:embed)");
    } else {
      console.log("unchanged");
    }
  } else {
    await prisma.knowledgeItem.create({ data: { tenantId: stingray.id, ...item, status: "approved" } });
    console.log("created — run db:embed to index");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
