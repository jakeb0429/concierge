import { prisma } from "./db";

/**
 * Deterministic product-mention extraction — matches inquiry text against the
 * ProductFamily master (silhouettes, frame colors, lens colors) and carries the
 * family's attributes (wrap/lifestyle, gender). No LLM: explicit mentions only,
 * so a null means "customer didn't name a product", never a guess.
 */

export type ProductMention = {
  productFamily: string | null;
  frameColor: string | null;
  lensColor: string | null;
  productStyle: string | null;
  productGender: string | null;
};

type FamilyRow = {
  name: string;
  frameColors: string[];
  lensColors: string[];
  style: string | null;
  gender: string | null;
  isSunglasses: boolean;
};

let cache: { rows: FamilyRow[]; at: number } | null = null;

/** Colorway words that leaked into HubSpot family names — never real silhouettes. */
const NOT_FAMILIES = new Set(["tortoise", "gunmetal", "marine", "smoke", "rose", "emerald", "thermal", "gradient", "mauve", "dusty rose"]);

async function families(): Promise<FamilyRow[]> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.rows;
  const all = await prisma.productFamily.findMany({ where: { isSunglasses: true } });
  const rows = all.filter((r) => !NOT_FAMILIES.has(r.name.toLowerCase()));
  // Longest names first so "Biscayne XL" wins over "Biscayne".
  rows.sort((a, b) => b.name.length - a.name.length);
  cache = { rows, at: Date.now() };
  return rows;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function extractProductMention(text: string): Promise<ProductMention> {
  const none: ProductMention = { productFamily: null, frameColor: null, lensColor: null, productStyle: null, productGender: null };
  if (!text) return none;
  const rows = await families();
  const hay = text.slice(0, 4000);

  let fam: FamilyRow | null = null;
  for (const r of rows) {
    // Word-boundary match; also accept the singular ("Eddie" for "Eddies").
    const base = r.name.endsWith("s") ? `${esc(r.name.slice(0, -1))}s?` : esc(r.name);
    if (new RegExp(`\\b${base}\\b`, "i").test(hay)) {
      fam = r;
      break;
    }
  }

  // Colors: prefer the matched family's option space; else any known color word.
  const framePool = fam ? fam.frameColors : [...new Set(rows.flatMap((r) => r.frameColors))];
  const lensPool = fam ? fam.lensColors : [...new Set(rows.flatMap((r) => r.lensColors))];
  const findColor = (pool: string[]) => {
    for (const c of pool.sort((a, b) => b.length - a.length)) {
      if (c && new RegExp(`\\b${esc(c)}\\b`, "i").test(hay)) return c;
    }
    return null;
  };
  const frameColor = findColor(framePool);
  // Lens color only meaningful alongside a product context; avoid matching
  // stray color words in unrelated mail when no family was named.
  const lensColor = fam ? findColor(lensPool.filter((l) => l !== frameColor)) : null;

  return {
    productFamily: fam?.name ?? null,
    frameColor: fam ? frameColor : null,
    lensColor,
    productStyle: fam?.style ?? null,
    productGender: fam?.gender ?? null,
  };
}
