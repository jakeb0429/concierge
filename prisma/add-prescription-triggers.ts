/**
 * One-off, idempotent: give the prescription FAQ trigger phrases so the
 * lexical (fast-path) retrieval catches it even when the semantic path is
 * unavailable (Voyage rate-limited) or the customer never types the literal
 * word "prescription" (Rx, "I wear glasses", "made to my script", ...).
 *
 * Only triggerPhrases change; title/answer are untouched, so no re-embed
 * is needed. Run:  npx tsx prisma/add-prescription-triggers.ts
 */
import { prisma } from "../src/lib/db";

const TITLE = "Do you offer prescription lenses?";
const TRIGGERS = [
  "prescription", "prescriptions", "prescription lenses", "prescription lens",
  "prescription sunglasses", "prescription glasses", "rx", "rx lenses",
  "rx sunglasses", "my prescription", "eye prescription", "made to my prescription",
  "corrective lenses", "i wear glasses", "wear glasses", "lensabl",
  "bifocal", "progressive lenses",
];

async function main() {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: "rheos" } });
  const item = await prisma.knowledgeItem.findFirst({
    where: { tenantId: tenant.id, title: TITLE },
    select: { id: true, triggerPhrases: true },
  });
  if (!item) throw new Error(`Not found: "${TITLE}"`);

  const same =
    item.triggerPhrases.length === TRIGGERS.length &&
    TRIGGERS.every((t) => item.triggerPhrases.includes(t));
  if (same) {
    console.log("Trigger phrases already set (no change).");
    return;
  }

  await prisma.knowledgeItem.update({
    where: { id: item.id },
    data: { triggerPhrases: TRIGGERS },
  });
  await prisma.auditEvent.create({
    data: {
      tenantId: tenant.id,
      action: "answer_promoted",
      entity: `knowledge:${item.id}`,
      meta: { title: TITLE, change: "added trigger phrases for lexical retrieval" },
    },
  });
  console.log(`Set ${TRIGGERS.length} trigger phrases on "${TITLE}".`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
