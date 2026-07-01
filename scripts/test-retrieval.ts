import { PrismaClient } from "@prisma/client";
import { retrieve } from "../src/lib/brain/retrieval";
const prisma = new PrismaClient();
async function main() {
  const rheos = await prisma.tenant.findUniqueOrThrow({ where: { slug: "rheos" } });
  for (const q of [
    "my shades got all scraped up at the beach, what are my options?",
    "will these sink if I drop them overboard?",
    "looking for something that fits a narrow face",
    "what should a dealer pay for the Coopers?",
  ]) {
    const items = await retrieve(rheos.id, q, 3);
    console.log(`\nQ: ${q}`);
    for (const i of items) console.log(`   [${i.via} ${i.score.toFixed(2)}] ${i.title}`);
    await new Promise((r) => setTimeout(r, 21000)); // free-tier pacing
  }
  await prisma.$disconnect();
}
main();
