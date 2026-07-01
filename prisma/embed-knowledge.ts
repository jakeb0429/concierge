import { PrismaClient } from "@prisma/client";
import { embed } from "../src/lib/brain/retrieval";

/**
 * Embedding backfill — embeds every KnowledgeItem that lacks a vector.
 * No-op (with a clear message) until VOYAGE_API_KEY is set, so it can sit in
 * cron safely; run it once after the key lands and the semantic index is live.
 *
 * Usage: tsx prisma/embed-knowledge.ts
 */

const prisma = new PrismaClient();

async function main() {
  if (!process.env.VOYAGE_API_KEY) {
    console.log("VOYAGE_API_KEY not set — skipping embedding backfill (add the key, then `npm run db:embed`).");
    return;
  }

  const items = await prisma.$queryRawUnsafe<{ id: string; title: string; answer: string }[]>(
    `SELECT id, title, answer FROM concierge."KnowledgeItem" WHERE embedding IS NULL`
  );
  console.log(`Embedding ${items.length} knowledge items…`);

  let done = 0;
  for (const item of items) {
    const vec = await embed(`${item.title}\n${item.answer}`, "document");
    await prisma.$executeRawUnsafe(
      `UPDATE concierge."KnowledgeItem" SET embedding = $1::extensions.vector WHERE id = $2`,
      `[${vec.join(",")}]`,
      item.id
    );
    done++;
    if (done % 20 === 0) console.log(`  ${done}/${items.length}`);
  }
  console.log(`Done — ${done} items embedded. Semantic retrieval is live.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
