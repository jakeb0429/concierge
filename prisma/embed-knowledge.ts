import { PrismaClient } from "@prisma/client";

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

  // Batched array requests, paced for Voyage's no-billing free tier
  // (3 requests/min, 10K tokens/min). ~35 entries ≈ 6K tokens per call.
  const BATCH = 25;
  let done = 0;
  for (let i = 0; i < items.length; i += BATCH) {
    if (i > 0) await new Promise((r) => setTimeout(r, 25_000)); // stay under 3 RPM
    const chunk = items.slice(i, i + BATCH);
    let json: { data: { index: number; embedding: number[] }[] } | null = null;
    for (let attempt = 0; attempt < 5 && !json; attempt++) {
      const res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: chunk.map((it) => `${it.title}\n${it.answer}`.slice(0, 4000)),
          model: "voyage-3-large",
          input_type: "document",
        }),
      });
      if (res.status === 429) {
        console.log(`  rate-limited, waiting 65s (attempt ${attempt + 1}/5)…`);
        await new Promise((r) => setTimeout(r, 65_000));
        continue;
      }
      if (!res.ok) throw new Error(`Voyage ${res.status}: ${await res.text()}`);
      json = (await res.json()) as { data: { index: number; embedding: number[] }[] };
    }
    if (!json) throw new Error("Voyage rate limit persisted after 5 retries.");
    for (const d of json.data) {
      await prisma.$executeRawUnsafe(
        `UPDATE concierge."KnowledgeItem" SET embedding = $1::extensions.vector WHERE id = $2`,
        `[${d.embedding.join(",")}]`,
        chunk[d.index].id
      );
      done++;
    }
    console.log(`  ${done}/${items.length}`);
  }
  console.log(`Done — ${done} items embedded. Semantic retrieval is live.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
