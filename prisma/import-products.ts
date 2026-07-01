import { PrismaClient } from "@prisma/client";

/**
 * Product master import — builds the Brand Brain's product reference from the
 * already-provisioned sources, deduped and compact (anti-bloat by design):
 *
 *   - HubSpot products  -> catalog spine: "Family | Frame color | Lens", SKU, WHOLESALE price
 *   - public."Product"  -> live inventory: quantity, replenishment status (rheos-inventory's
 *                          table in this same database, synced nightly)
 *   - Shopify products.json -> retail price + product_type (public, no auth)
 *
 * Output: ONE approved KnowledgeItem per frame family (colors, lenses, sizes,
 * prices, stock) + one regenerating "Inventory & replenishment snapshot" entry.
 * Upserted by title so re-runs update in place — never accumulate.
 *
 * Usage: tsx prisma/import-products.ts
 */

const prisma = new PrismaClient();
const HS = process.env.HUBSPOT_TOKEN!;

type SkuRecord = {
  sku: string;
  family: string;
  frameColor: string | null;
  lens: string | null;
  wholesale: number | null;
  retail: number | null;
  qty: number;
  replen: string | null;
  type: string | null;
};

async function hubspotCatalog(): Promise<Map<string, { name: string; price: number | null }>> {
  const out = new Map<string, { name: string; price: number | null }>();
  let after: string | undefined;
  do {
    const res = await fetch(
      `https://api.hubapi.com/crm/v3/objects/products?limit=100&properties=name,hs_sku,price${after ? `&after=${after}` : ""}`,
      { headers: { Authorization: `Bearer ${HS}` } }
    );
    if (!res.ok) throw new Error(`HubSpot ${res.status}`);
    const json = (await res.json()) as {
      results: { properties: { name: string; hs_sku: string | null; price: string | null } }[];
      paging?: { next?: { after: string } };
    };
    for (const r of json.results) {
      if (r.properties.hs_sku && r.properties.name)
        out.set(r.properties.hs_sku, {
          name: r.properties.name,
          price: r.properties.price ? Number(r.properties.price) : null,
        });
    }
    after = json.paging?.next?.after;
  } while (after);
  return out;
}

async function shopifyCatalog(): Promise<{
  bySku: Map<string, { type: string; price: number }>;
  titles: string[];
}> {
  const bySku = new Map<string, { type: string; price: number }>();
  const titles: string[] = [];
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(`https://rheosgear.com/products.json?limit=250&page=${page}`);
    if (!res.ok) break;
    const json = (await res.json()) as {
      products: { title: string; product_type: string; variants: { sku: string | null; price: string }[] }[];
    };
    if (!json.products.length) break;
    for (const p of json.products) {
      titles.push(p.title);
      for (const v of p.variants) if (v.sku) bySku.set(v.sku, { type: p.product_type, price: Number(v.price) });
    }
  }
  return { bySku, titles };
}

/**
 * Normalize a HubSpot family segment onto a canonical frame family.
 * HubSpot naming is inconsistent ("Bahias", "Bahias - Floating",
 * "Floating Polarized Sunglasses - Bahias - Tortoise" are one family) —
 * Shopify's clean titles are the canon; longest match wins ("Biscayne XL"
 * before "Biscayne").
 */
function normalizeFamily(rawFamily: string, canon: string[]): string {
  const cleaned = rawFamily
    .replace(/^clearance\s+/i, "")
    .replace(/^floating (polarized )?(sunglasses|glasses)\s*-\s*/i, "")
    .replace(/^polarized\s*-\s*/i, "")
    .trim();
  const lower = cleaned.toLowerCase();
  const sorted = [...canon].sort((a, b) => b.length - a.length);
  for (const c of sorted) {
    const cl = c.toLowerCase();
    if (lower === cl || lower.startsWith(cl + " ") || lower.startsWith(cl + "-") || lower.includes(` ${cl}`) || new RegExp(`\\b${cl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(cleaned))
      return c;
  }
  // No canonical match — strip a trailing " - Color" style suffix.
  return cleaned.split(" - ")[0].trim();
}

function parseName(name: string): { family: string; frameColor: string | null; lens: string | null } {
  // HubSpot format: "Stono | Mauve | Gradient"  (family | frame color | lens)
  const parts = name.split("|").map((s) => s.trim());
  return { family: parts[0] ?? name, frameColor: parts[1] ?? null, lens: parts[2] ?? null };
}

const money = (n: number | null) => (n == null ? null : `$${n.toFixed(2).replace(/\.00$/, "")}`);

/** Upsert a Brand Brain entry by (tenant, title) — update in place, never accumulate. */
async function upsertEntry(args: {
  tenantId: string;
  title: string;
  answer: string;
  triggerPhrases: string[];
  tags: string[];
  category: string;
  sourceRef: string;
}) {
  const existing = await prisma.knowledgeItem.findFirst({
    where: { tenantId: args.tenantId, title: args.title },
    select: { id: true, version: true, answer: true },
  });
  if (existing) {
    await prisma.knowledgeItem.update({
      where: { id: existing.id },
      data: {
        answer: args.answer,
        triggerPhrases: args.triggerPhrases,
        sourceRef: args.sourceRef,
        version: existing.answer === args.answer ? existing.version : existing.version + 1,
      },
    });
  } else {
    await prisma.knowledgeItem.create({
      data: { ...args, kind: "product", status: "approved" },
    });
  }
}

async function main() {
  const rheos = await prisma.tenant.findUniqueOrThrow({ where: { slug: "rheos" } });
  const [catalog, shopify] = await Promise.all([hubspotCatalog(), shopifyCatalog()]);
  const shopTypes = shopify.bySku;
  const dbProducts = await prisma.$queryRawUnsafe<
    { sku: string; name: string; price: unknown; quantity: number; replenishment: string | null }[]
  >(`SELECT sku, name, price, quantity, replenishment FROM public."Product"`);
  const dbBySku = new Map(dbProducts.map((p) => [p.sku, p]));
  console.log(`Sources: HubSpot ${catalog.size} SKUs · public.Product ${dbProducts.length} · Shopify ${shopTypes.size}`);

  // The import owns its categories — wipe and rebuild so runs converge.
  await prisma.knowledgeItem.deleteMany({
    where: { tenantId: rheos.id, category: { in: ["Product Catalog", "Inventory", "Wholesale"] } },
  });

  const records: SkuRecord[] = [];
  for (const [sku, hs] of catalog) {
    // HubSpot catalog junk — test rows, dupes, placeholder items.
    if (/\(copy\)|^no match$|^other item$/i.test(hs.name.split("|")[0].trim())) continue;
    const parsed = parseName(hs.name);
    const db = dbBySku.get(sku);
    const shop = shopTypes.get(sku);
    const isDisplay = /display|shipper box|demo add-on|cloth\b/i.test(parsed.family);
    const family = isDisplay
      ? "__DISPLAYS__"
      : normalizeFamily(parsed.family.replace(/^accessories:/i, ""), shopify.titles);
    records.push({
      sku,
      family,
      frameColor: parsed.frameColor,
      lens: parsed.lens,
      wholesale: hs.price,
      retail: shop?.price ?? (db ? Number(db.price) : null),
      qty: db?.quantity ?? 0,
      replen: db?.replenishment ?? null,
      type: shop?.type ?? null,
    });
  }

  const families = new Map<string, SkuRecord[]>();
  for (const r of records) {
    if (!families.has(r.family)) families.set(r.family, []);
    families.get(r.family)!.push(r);
  }

  // Displays & POS material -> one wholesale-facing entry, not N catalog rows.
  const displays = families.get("__DISPLAYS__") ?? [];
  families.delete("__DISPLAYS__");
  if (displays.length) {
    await upsertEntry({
      tenantId: rheos.id,
      title: "Wholesale displays & POS materials",
      answer:
        `Available to dealers: ${displays
          .map((d) => `${d.family === "__DISPLAYS__" ? "" : ""}${catalog.get(d.sku)?.name?.split("|")[0]?.trim()}${d.wholesale ? ` (${money(d.wholesale)})` : ""}${d.qty > 0 ? "" : " — currently out of stock"}`)
          .join("; ")}. ` + `Displays ship with wholesale orders; ask the rep for current lead times.`,
      triggerPhrases: ["display", "pos", "floor display", "countertop display", "shipper"],
      tags: ["product", "wholesale", "displays"],
      category: "Wholesale",
      sourceRef: `product-import: displays (${displays.length} SKUs)`,
    });
  }

  let productEntries = 0;
  const discontinued: string[] = [];
  for (const [family, skus] of families) {
    const isSunglasses = skus.some((s) => s.frameColor || (s.type ?? "").toLowerCase().includes("sunglass"));
    const frameColors = [...new Set(skus.map((s) => s.frameColor).filter(Boolean))] as string[];
    const lenses = [...new Set(skus.map((s) => s.lens).filter(Boolean))] as string[];
    const retail = [...new Set(skus.map((s) => s.retail).filter((n) => n != null))] as number[];
    const wholesale = [...new Set(skus.map((s) => s.wholesale).filter((n) => n != null))] as number[];
    const inStock = skus.filter((s) => s.qty > 0);
    const gone = skus.length > 0 && skus.every((s) => s.replen === "Gone forever");
    if (gone) discontinued.push(family);
    const size = /\bXL\b/i.test(family)
      ? "XL (larger fit)"
      : /\b(small|petite|slim)\b/i.test(family)
        ? "smaller fit"
        : null;

    const lines = [
      isSunglasses
        ? `${family} — floating sunglasses${size ? `, ${size}` : ""}${skus[0]?.type ? ` (${skus[0].type.replace("Sunglasses - ", "")} line)` : ""}.`
        : `${family} — ${skus[0]?.type ?? "accessory"}.`,
      frameColors.length ? `Frame colors: ${frameColors.join(", ")}.` : null,
      lenses.length ? `Lens colors: ${lenses.join(", ")}.` : null,
      retail.length ? `Retail: ${retail.map(money).join(" / ")}.` : null,
      wholesale.length ? `Wholesale: ${wholesale.map(money).join(" / ")}.` : null,
      gone
        ? `DISCONTINUED — gone forever once sold out. Do not promise restock.`
        : `In stock: ${inStock.length}/${skus.length} variants${
            inStock.length
              ? ` (${inStock
                  .slice(0, 6)
                  .map((s) => [s.frameColor, s.lens].filter(Boolean).join("/") || s.sku)
                  .join(", ")}${inStock.length > 6 ? "…" : ""})`
              : " — currently OUT OF STOCK across all variants"
          }.`,
      skus.some((s) => s.replen === "Sunset at Regular Price") && !gone
        ? `Note: some variants are sunsetting (no restock planned once sold out).`
        : null,
    ].filter(Boolean) as string[];

    await upsertEntry({
      tenantId: rheos.id,
      title: `Product: ${family}`,
      answer: lines.join(" "),
      triggerPhrases: [family.toLowerCase(), ...frameColors.map((c) => c.toLowerCase()).slice(0, 4)],
      tags: ["product", "catalog", ...(isSunglasses ? ["sunglasses"] : ["accessory"])],
      category: "Product Catalog",
      sourceRef: `product-import: hubspot+public.Product+shopify (${skus.length} SKUs)`,
    });
    productEntries++;
  }

  // Regenerating inventory snapshot — ONE entry, rewritten each run (never accumulates).
  const restockable = records.filter((r) => r.replen === "Replenishment");
  const oosRestockable = restockable.filter((r) => r.qty <= 0);
  const fba = await prisma.$queryRawUnsafe<
    { productName: string; unitsAvailable: number; recommendedReplenishmentQty: number }[]
  >(
    `SELECT "productName", "unitsAvailable", "recommendedReplenishmentQty"
     FROM public."FbaRestockRecommendation"
     WHERE alert IS NOT NULL AND alert != '' ORDER BY "recommendedReplenishmentQty" DESC NULLS LAST LIMIT 8`
  );

  const snapshot = [
    `As of ${new Date().toISOString().slice(0, 10)}: ${records.length} active SKUs across ${families.size} product families.`,
    `${restockable.length} SKUs are on the replenishment program${
      oosRestockable.length
        ? `; ${oosRestockable.length} of them are currently out of stock awaiting restock (${oosRestockable
            .slice(0, 5)
            .map((r) => `${r.family} ${[r.frameColor, r.lens].filter(Boolean).join("/")}`)
            .join(", ")}${oosRestockable.length > 5 ? "…" : ""})`
        : ""
    }.`,
    discontinued.length
      ? `Discontinued (gone forever, never promise restock): ${discontinued.join(", ")}.`
      : null,
    fba.length
      ? `Amazon FBA restock alerts: ${fba
          .slice(0, 5)
          .map((f) => `${f.productName?.split("|")[0]?.trim()} (${f.unitsAvailable} avail, restock ${f.recommendedReplenishmentQty})`)
          .join("; ")}.`
      : null,
    `For anything time-sensitive a rep should verify in the inventory system — this snapshot refreshes on each import run.`,
  ].filter(Boolean) as string[];

  await upsertEntry({
    tenantId: rheos.id,
    title: "Inventory & replenishment snapshot",
    answer: snapshot.join(" "),
    triggerPhrases: ["in stock", "out of stock", "back in stock", "restock", "inventory", "when will it be available", "discontinued"],
    tags: ["product", "inventory", "replenishment"],
    category: "Inventory",
    sourceRef: `product-import: public.Product + FbaRestockRecommendation`,
  });

  console.log(`Upserted ${productEntries} product-family entries + 1 inventory snapshot. Discontinued families: ${discontinued.length}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
