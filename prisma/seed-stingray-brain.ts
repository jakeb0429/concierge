import { PrismaClient } from "@prisma/client";
import models from "./seed/stingray-boat-models.json";

/**
 * Stingray Brand Brain seed — the boat lineup, vendored from the boat
 * builder's own source data (stingray-boat-builder-ai assets/data/models.json,
 * the same file its seed.py builds the configurator from). Descriptions,
 * specs, and positioning only — NO pricing (engine-dependent, seasonal, and
 * dealer-tier-gated; a draft must never quote a number the configurator owns).
 *
 * Idempotent: upserts by (tenant, title); a changed answer clears the
 * embedding so db:embed re-indexes it. Re-run any time the JSON updates.
 * Usage: npx tsx prisma/seed-stingray-brain.ts
 */

const prisma = new PrismaClient();

type BoatModel = {
  model: string;
  category: string;
  tagline: string;
  description: string;
  best_for: string;
  engine_brands: string[];
  specs: Record<string, string | number>;
};

const SPEC_LABEL: Record<string, string> = {
  length: "Length",
  beam: "Beam",
  max_hp: "Max HP",
  weight: "Weight",
  capacity: "Capacity",
  fuel: "Fuel",
  deadrise: "Deadrise",
  draft_up: "Draft (engine up)",
  draft_down: "Draft (engine down)",
  bridge_clearance: "Bridge clearance",
};

function modelAnswer(m: BoatModel): string {
  const specs = Object.entries(m.specs)
    .map(([k, v]) => `${SPEC_LABEL[k] ?? k}: ${v}`)
    .join(" · ");
  return (
    `${m.model} (${m.category}) — ${m.tagline}.\n\n${m.description}\n\n` +
    `Best for: ${m.best_for}.\nEngine brands offered: ${m.engine_brands.join(", ")}.\n` +
    `Specs: ${specs}.\n` +
    `Pricing and option configuration live in the Boat Builder / with the dealer — never quote a price from memory.`
  );
}

/** "173CC" also matches "173 cc" / "173-CC" in customer emails. */
function modelTriggers(model: string): string[] {
  const spaced = model.replace(/([0-9])([A-Z])/g, "$1 $2");
  return [...new Set([model.toLowerCase(), spaced.toLowerCase()])];
}

async function main() {
  const stingray = await prisma.tenant.findUniqueOrThrow({ where: { slug: "stingray" } });
  const boats = models as BoatModel[];
  let created = 0;
  let updated = 0;

  const upsert = async (item: {
    kind: string; title: string; answer: string; triggerPhrases: string[];
    tags: string[]; category: string; sourceRef: string;
  }) => {
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
        updated++;
      }
    } else {
      await prisma.knowledgeItem.create({
        data: { tenantId: stingray.id, ...item, status: "approved" },
      });
      created++;
    }
  };

  for (const m of boats) {
    await upsert({
      kind: "product",
      title: `Boat model: ${m.model}`,
      answer: modelAnswer(m),
      triggerPhrases: modelTriggers(m.model),
      tags: ["product", "boat-model", m.category.toLowerCase().replace(/\s+/g, "-")],
      category: "Product Catalog",
      sourceRef: "stingray-boat-builder-ai assets/data/models.json",
    });
  }

  // One lineup overview so "what boats do you make" grounds cleanly.
  const byCategory = new Map<string, string[]>();
  for (const m of boats) {
    byCategory.set(m.category, [...(byCategory.get(m.category) ?? []), m.model]);
  }
  await upsert({
    kind: "product",
    title: "Stingray boat lineup — models by category",
    answer:
      "Stingray builds boats on the exclusive Z-Plane hull across four categories. " +
      [...byCategory.entries()].map(([cat, ms]) => `${cat}: ${ms.join(", ")}`).join(". ") +
      ". Every model page and full configuration lives in the Boat Builder; dealers handle pricing and delivery.",
    triggerPhrases: ["lineup", "what models", "which boats", "model list", "boat models"],
    tags: ["product", "lineup"],
    category: "Product Catalog",
    sourceRef: "stingray-boat-builder-ai assets/data/models.json",
  });

  console.log(`Stingray brain: ${created} created, ${updated} updated (of ${boats.length + 1} items).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
