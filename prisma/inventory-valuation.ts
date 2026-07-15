import { PrismaClient } from "@prisma/client";

/**
 * Inventory valuation report — read-only. Prices the on-hand inventory at
 * Jake's book unit costs and prints a category breakdown plus a grand total.
 *
 * Quantities come from public."Product" (rheos-inventory's table in this same
 * database, synced nightly) — the same source import-products.ts uses. HubSpot
 * carries the catalog/wholesale prices, not stock, so it is not consulted here.
 * Replacement arms are valued from concierge.ArmInventory (the parts desk's
 * left/right counts), and any arm rows found in public."Product" are excluded
 * from the totals to avoid double counting.
 *
 * Unit costs (override via env):
 *   COST_SUNGLASSES=16  COST_HARD_CASE=3.50  COST_CAPTAINS_PACK=6
 *   COST_ARM=0.05  COST_DISPLAY_LOW=150  COST_DISPLAY_HIGH=250
 *
 * Usage: tsx prisma/inventory-valuation.ts
 *   (on birdseye: ssh root@72.61.177.29 'cd /opt/concierge && npx tsx prisma/inventory-valuation.ts')
 */

const prisma = new PrismaClient();

const num = (v: string | undefined, dflt: number) => {
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : dflt;
};
const COST = {
  sunglasses: num(process.env.COST_SUNGLASSES, 16),
  hardCase: num(process.env.COST_HARD_CASE, 3.5),
  captainsPack: num(process.env.COST_CAPTAINS_PACK, 6),
  arm: num(process.env.COST_ARM, 0.05),
  displayLow: num(process.env.COST_DISPLAY_LOW, 150),
  displayHigh: num(process.env.COST_DISPLAY_HIGH, 250),
};

type Bucket = "sunglasses" | "hardCase" | "captainsPack" | "display" | "arm" | "other";

/** First matching accessory pattern wins; everything unmatched is a frame. */
function classify(name: string, sku: string): Bucket {
  const n = name.toLowerCase();
  if (/captain/.test(n)) return "captainsPack";
  if (/\bcase\b|\bcases\b/.test(n)) return "hardCase";
  if (/display|shipper/.test(n)) return "display";
  if (/\barms?\b|\btemples?\b/.test(n) || /^13\d{3}-/.test(sku)) return "arm";
  // POS / non-inventory catalog rows we don't carry at a unit cost.
  if (/cloth|retainer|pouch|sticker|decal|gift card|demo add-on|shipping|sample|warranty/.test(n)) return "other";
  return "sunglasses";
}

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

async function main() {
  const rows = await prisma.$queryRawUnsafe<{ sku: string; name: string; quantity: number }[]>(
    `SELECT sku, name, quantity FROM public."Product"`
  );

  const units: Record<Bucket, number> = { sunglasses: 0, hardCase: 0, captainsPack: 0, display: 0, arm: 0, other: 0 };
  const skus: Record<Bucket, number> = { ...units };
  const review: string[] = [];

  for (const r of rows) {
    const qty = r.quantity ?? 0;
    const bucket = classify(r.name ?? "", r.sku ?? "");
    skus[bucket]++;
    if (qty < 0) review.push(`NEGATIVE qty ${qty}: ${r.sku} ${r.name}`);
    units[bucket] += Math.max(0, qty);
    if (bucket === "other" && qty > 0) review.push(`unvalued (other): ${r.sku} ${r.name} × ${qty}`);
  }

  // Arms: the parts desk's ArmInventory is the source of truth (left+right).
  const arms = await prisma.armInventory.aggregate({ _sum: { leftCount: true, rightCount: true } });
  const armUnits = (arms._sum.leftCount ?? 0) + (arms._sum.rightCount ?? 0);

  const val = {
    sunglasses: units.sunglasses * COST.sunglasses,
    hardCase: units.hardCase * COST.hardCase,
    captainsPack: units.captainsPack * COST.captainsPack,
    arm: armUnits * COST.arm,
    displayLow: units.display * COST.displayLow,
    displayHigh: units.display * COST.displayHigh,
  };
  const totalLow = val.sunglasses + val.hardCase + val.captainsPack + val.arm + val.displayLow;
  const totalHigh = val.sunglasses + val.hardCase + val.captainsPack + val.arm + val.displayHigh;

  console.log(`Inventory valuation — ${new Date().toISOString().slice(0, 10)} (public."Product": ${rows.length} SKUs)`);
  console.log(`  Sunglasses      ${String(units.sunglasses).padStart(7)} units × ${money(COST.sunglasses)}  = ${money(val.sunglasses)}  (${skus.sunglasses} SKUs)`);
  console.log(`  Hard cases      ${String(units.hardCase).padStart(7)} units × ${money(COST.hardCase)}   = ${money(val.hardCase)}  (${skus.hardCase} SKUs)`);
  console.log(`  Captains packs  ${String(units.captainsPack).padStart(7)} units × ${money(COST.captainsPack)}      = ${money(val.captainsPack)}  (${skus.captainsPack} SKUs)`);
  console.log(`  Displays        ${String(units.display).padStart(7)} units × ${money(COST.displayLow)}–${money(COST.displayHigh)} = ${money(val.displayLow)}–${money(val.displayHigh)}  (${skus.display} SKUs)`);
  console.log(`  Arms (ArmInventory) ${String(armUnits).padStart(3)} units × ${money(COST.arm)}  = ${money(val.arm)}`);
  if (units.arm > 0)
    console.log(`  (note: ${units.arm} arm units also present in public."Product" across ${skus.arm} SKUs — excluded to avoid double counting)`);
  console.log(`  TOTAL: ${money(totalLow)} – ${money(totalHigh)}`);
  if (review.length) {
    console.log(`\nReview (${review.length} rows not valued or negative):`);
    for (const line of review) console.log(`  - ${line}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
