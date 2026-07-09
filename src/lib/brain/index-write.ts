import { prisma } from "../db";
import { logger } from "../log";
import { embed } from "./retrieval";

/**
 * Keep the semantic index fresh on write (Section 3.2 "Freshness"): whenever an
 * entry is created or its answer changes, re-embed it immediately so the new
 * answer is usable on the very next ticket. Best-effort and silently skipped
 * until VOYAGE_API_KEY exists — the lexical fast path keeps working either way.
 */
export async function reindexKnowledgeItem(id: string, title: string, answer: string): Promise<void> {
  if (!process.env.VOYAGE_API_KEY) return;
  try {
    const vec = await embed(`${title}\n${answer}`, "document");
    await prisma.$executeRawUnsafe(
      `UPDATE concierge."KnowledgeItem" SET embedding = $1::extensions.vector WHERE id = $2`,
      `[${vec.join(",")}]`,
      id
    );
  } catch (e) {
    logger.error({ err: e, knowledgeItemId: id }, "[reindex] embedding failed, entry still usable via lexical fast path");
  }
}
