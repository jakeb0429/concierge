import { prisma } from "./db";

/**
 * Stockist intelligence — which retail accounts bought which products, when,
 * where (from HubSpot won-deal line items, synced nightly). Answers "which
 * store near the customer carries X" for reps and draft grounding.
 *
 * Honest caveat baked into every consumer: this is what stores ORDERED from
 * us, not live shelf inventory — recency is the signal.
 */

export type StockistHit = {
  companyName: string;
  city: string | null;
  state: string | null;
  lastOrderedAt: Date;
  totalQty: number;
  products: string[]; // distinct families in the window
};

export async function findStockists(opts: {
  tenantId: string;
  productFamily?: string | null;
  place?: string | null; // city or state fragment, e.g. "Charleston" or "SC"
  months?: number;
  limit?: number;
  /** internal: the same-state backfill must not backfill again */
  noBackfill?: boolean;
}): Promise<StockistHit[]> {
  const { tenantId, productFamily, place, months = 12, limit = 8 } = opts;
  const since = new Date(Date.now() - months * 30 * 86_400_000);

  const rows = await prisma.stockistSale.findMany({
    where: {
      tenantId,
      closedAt: { gte: since },
      ...(productFamily ? { productFamily: { equals: productFamily, mode: "insensitive" } } : {}),
      ...(place
        ? {
            OR: [
              { city: { contains: place, mode: "insensitive" } },
              { state: { contains: place, mode: "insensitive" } },
              { zip: { startsWith: place } },
            ],
          }
        : {}),
    },
    orderBy: { closedAt: "desc" },
    take: 500,
  });

  const byCompany = new Map<string, StockistHit>();
  for (const r of rows) {
    const key = `${r.companyName}|${r.city ?? ""}`;
    const hit = byCompany.get(key) ?? {
      companyName: r.companyName,
      city: r.city,
      state: r.state,
      lastOrderedAt: r.closedAt,
      totalQty: 0,
      products: [],
    };
    hit.totalQty += r.quantity;
    if (r.closedAt > hit.lastOrderedAt) hit.lastOrderedAt = r.closedAt;
    if (r.productFamily && !hit.products.includes(r.productFamily)) hit.products.push(r.productFamily);
    byCompany.set(key, hit);
  }
  const hits = [...byCompany.values()].sort((a, b) => b.lastOrderedAt.getTime() - a.lastOrderedAt.getTime());

  // A city match ("Charleston") should surface the AREA too — Sullivan's
  // Island, Mount Pleasant, typo'd cities — so backfill remaining slots with
  // same-state accounts (each line carries its city, so distance stays obvious).
  if (place && !opts.noBackfill && hits.length > 0 && hits.length < limit) {
    const state = hits[0].state;
    if (state) {
      const extra = await findStockists({ tenantId, productFamily, place: state, months, limit: limit * 2, noBackfill: true });
      const seen = new Set(hits.map((h) => `${h.companyName}|${h.city ?? ""}`));
      for (const e of extra) {
        const k = `${e.companyName}|${e.city ?? ""}`;
        if (!seen.has(k)) {
          hits.push(e);
          seen.add(k);
        }
      }
    }
  }
  return hits.slice(0, limit);
}

export function stockistLines(hits: StockistHit[], productFamily?: string | null): string[] {
  return hits.map((h) => {
    const where = [h.city, h.state].filter(Boolean).join(", ");
    const when = h.lastOrderedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return `${h.companyName}${where ? ` (${where})` : ""} — last wholesale order ${when}, ${h.totalQty} unit${h.totalQty === 1 ? "" : "s"}${
      productFamily ? ` of ${productFamily}` : h.products.length ? ` across ${h.products.slice(0, 4).join("/")}` : ""
    }`;
  });
}

/**
 * Detect a place the customer mentioned by matching our stockists' own
 * cities/states against the ticket text — no geocoding, just "did they name
 * somewhere we actually sell". Returns the matched fragment or null.
 */
export async function detectPlace(tenantId: string, text: string): Promise<string | null> {
  const rows = await prisma.stockistSale.groupBy({ by: ["city"], where: { tenantId, city: { not: null } }, _count: true });
  const hay = text.toLowerCase();
  // Longest city names first so "North Charleston" beats "Charleston".
  const cities = rows
    .map((r) => (r.city ?? "").trim())
    .filter((c) => c.length > 3)
    .sort((a, b) => b.length - a.length);
  for (const c of cities) {
    if (hay.includes(c.toLowerCase())) return c;
  }
  return null;
}
