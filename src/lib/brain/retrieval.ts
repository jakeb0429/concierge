import { prisma } from "../db";
import { logger } from "../log";
import { anthropic, CLAUDE_MODEL } from "../anthropic";

/**
 * Brand Brain retrieval — the fast path + smart path (Section 3.2).
 *
 *   1. Canonical intent match (fast path): a recognized trigger phrase returns
 *      the approved answer immediately, no guessing.
 *   2. Semantic match (smart path): pgvector cosine similarity over embeddings
 *      for the long tail.
 *
 * The draft is grounded ONLY in what these return, and cites them.
 */

export interface RetrievedItem {
  id: string;
  title: string;
  answer: string;
  score: number;
  via: "canonical" | "semantic";
}

/**
 * Embed text for indexing or query — Voyage AI (1024-dim, matches the schema).
 * `document` when storing a KnowledgeItem, `query` when retrieving for a ticket.
 * Isolated here so the provider is a one-function swap.
 */
export async function embed(text: string, inputType: "document" | "query" = "query"): Promise<number[]> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: text, model: "voyage-3-large", input_type: inputType }),
    // Voyage answers single-text embeds in well under 10s — a hung socket
    // must not stall drafting or index writes.
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Voyage embeddings failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data[0].embedding;
}

/** Crude stemmer so "scratches" ~ "scratched" and "lenses" ~ "lens" match. */
function stems(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().match(/[a-z]{4,}/g) ?? []) {
    out.add(w.replace(/(ing|ed|es|s)$/, ""));
  }
  return out;
}

export async function retrieve(tenantId: string, query: string, k = 6): Promise<RetrievedItem[]> {
  const qLower = query.toLowerCase();
  const qStems = stems(query);

  // Fast path: lexical intent match over trigger phrases + title/category, stemmed.
  // A full trigger phrase found verbatim is a strong signal; shared stems add weight.
  const approved = await prisma.knowledgeItem.findMany({
    where: { tenantId, status: "approved" },
    select: {
      id: true, title: true, answer: true, category: true, kind: true,
      triggerPhrases: true, tags: true, conditions: true, avoidNotes: true,
      exemplar: true, version: true, sourceRef: true,
    },
  });

  const scored = approved
    .map((c) => {
      let raw = 0;
      for (const p of c.triggerPhrases) {
        if (p && qLower.includes(p.toLowerCase())) raw += 2;
      }
      const itemStems = stems([c.title, c.category ?? "", ...c.triggerPhrases].join(" "));
      for (const s of itemStems) if (qStems.has(s)) raw += 1;
      return { c, raw };
    })
    .filter((s) => s.raw > 0)
    .sort((a, b) => b.raw - a.raw)
    .slice(0, k);

  const items: RetrievedItem[] = scored.map(({ c, raw }) => ({
    id: c.id,
    title: c.title,
    answer: c.answer,
    score: Math.min(0.99, 0.55 + 0.12 * raw), // display confidence
    via: "canonical" as const,
  }));

  // Smart path: pgvector similarity for whatever the fast path didn't cover.
  // Skipped gracefully until a Voyage key is configured — the canonical path still works.
  // Enrichment, so a Voyage failure/timeout degrades to canonical-only rather
  // than failing the whole retrieval (and with it the draft).
  if (items.length < k && process.env.VOYAGE_API_KEY) {
    try {
      const vec = await embed(query);
      const rows = await prisma.$queryRawUnsafe<
        { id: string; title: string; answer: string; score: number }[]
      >(
        `SELECT id, title, answer, 1 - (embedding OPERATOR(extensions.<=>) $1::extensions.vector) AS score
         FROM concierge."KnowledgeItem"
         WHERE "tenantId" = $2 AND status = 'approved' AND embedding IS NOT NULL
         ORDER BY embedding OPERATOR(extensions.<=>) $1::extensions.vector
         LIMIT $3`,
        `[${vec.join(",")}]`,
        tenantId,
        k - items.length
      );
      const seen = new Set(items.map((i) => i.id));
      for (const r of rows) if (!seen.has(r.id)) items.push({ ...r, via: "semantic" });
    } catch (e) {
      logger.error({ err: e }, "[retrieve] semantic pass failed — returning canonical matches only");
    }
  }

  return items;
}

export const _model = CLAUDE_MODEL;
export const _client = anthropic;
