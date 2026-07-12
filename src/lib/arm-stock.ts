import { prisma } from "./db";

/**
 * Replacement-arm stock lookup for the warranty/parts draft context. Reps
 * identify the arm by SKU (or model + colorway + photo), so we surface stock
 * per SKU for whichever frame model(s) the ticket names. The whole arm table
 * is ~70 rows, so we load it once and match in memory.
 */

export type ArmRow = {
  id: string;
  sku: string;
  brand: string;
  container: number | null;
  leftCount: number;
  rightCount: number;
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Which arm brands (frame models) does this text name? Exact whole-model-name
 * match only — deliberately no singular/substring fuzzing. That avoids
 * injecting the wrong SKUs from collisions with customer first names
 * ("Thanks, Eddie" vs "Eddies"), common words ("deal breaker" vs "Breakers"),
 * and adjacent models ("Biscayne XL" vs "Biscaynes"). Informal singular
 * phrasings ("my cooper") are caught upstream: the caller folds the
 * normalized product family into the haystack. Min length 4 blocks a
 * pathologically short brand name from matching everything.
 */
export function matchArmBrands(rows: ArmRow[], haystack: string): string[] {
  const hay = haystack.toLowerCase();
  const brands = [...new Set(rows.map((r) => r.brand))];
  return brands
    .filter((b) => {
      const lb = b.toLowerCase();
      return lb.length >= 4 && new RegExp(`\\b${escapeRe(lb)}\\b`).test(hay);
    })
    .sort((a, b) => b.length - a.length);
}

/** One trusted live-context line per matched brand, listing per-SKU stock. */
export function armStockLines(rows: ArmRow[], brands: string[]): string[] {
  const lines: string[] = [];
  for (const brand of brands) {
    const brandRows = rows.filter((r) => r.brand.toLowerCase() === brand.toLowerCase());
    if (!brandRows.length) continue;
    const anyStock = brandRows.some((r) => r.leftCount > 0 || r.rightCount > 0);
    if (!anyStock) {
      lines.push(`Replacement arm stock for ${brand} (parts inventory): none on hand for this style.`);
      continue;
    }
    const parts = brandRows.map((r) => `${r.sku}: ${r.leftCount} left, ${r.rightCount} right`).join("; ");
    lines.push(`Replacement arm stock for ${brand} (parts inventory): ${parts}.`);
  }
  return lines;
}

/** Trusted live-context lines for a ticket, or [] when no known model is named. */
export async function armStockContext(tenantId: string, haystack: string): Promise<string[]> {
  const rows = await prisma.armInventory.findMany({
    where: { tenantId },
    select: { id: true, sku: true, brand: true, container: true, leftCount: true, rightCount: true },
    orderBy: [{ brand: "asc" }, { sku: "asc" }],
  });
  if (!rows.length) return [];
  return armStockLines(rows, matchArmBrands(rows, haystack));
}
