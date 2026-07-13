import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { sessionUser } from "@/lib/roles";
import { logger } from "@/lib/log";

/**
 * Orderable product catalog for the Order panel's searchable picker. Returns
 * Rheos products that are both ORDERABLE (have a Shopify variant, so the SKU
 * resolves at checkout) and AVAILABLE (in stock OR actively replenished).
 * Discontinued / clearance / gone-forever / under-review SKUs are excluded — a
 * rep can't sell them, so they don't appear. Small list (~50), so the client
 * fetches it once and filters as the rep types.
 *
 * public."Product" is Rheos's global catalog (no tenantId), so it's served only
 * to the Rheos tenant.
 */

type Row = {
  sku: string;
  name: string | null;
  frameName: string | null;
  frameColor: string | null;
  lensColor: string | null;
  price: string | null;
  quantity: number;
  replenishment: string | null;
};

export async function GET() {
  const tenant = await getCurrentTenant();
  const me = await sessionUser();
  if (!me?.id) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (tenant.slug !== "rheos") return NextResponse.json({ products: [] });

  let rows: Row[] = [];
  try {
    rows = await prisma.$queryRawUnsafe<Row[]>(
      // MSRP = "expectedRetailPrice" (the retail price the customer pays, and what
      // Shopify charges), NOT "price" (which is the wholesale/cost, ~half). Fall
      // back to price only if the retail price is missing.
      `SELECT sku, name, "frameName", "frameColor", "lensColor",
              COALESCE("expectedRetailPrice", price)::text AS price, quantity, replenishment
       FROM public."Product"
       WHERE "shopifyId" IS NOT NULL
         AND (quantity > 0 OR replenishment = 'Replenishment')
       ORDER BY name ASC`,
    );
  } catch (e) {
    logger.error({ err: e }, "[products] catalog query failed");
    return NextResponse.json({ error: "Couldn't load the product catalog." }, { status: 500 });
  }

  const products = rows.map((r) => {
    // Clean the messy sync name ("Sunglasses:Bimini - Gunmetal | Smoke") into a
    // readable label; fall back to frameName then the sku.
    const label =
      (r.name ?? "").replace(/^[A-Za-z ]+:/, "").replace(/\s*\|\s*/g, " / ").trim() ||
      r.frameName ||
      r.sku;
    return {
      sku: r.sku,
      label,
      // MSRP / retail price the customer pays before any discount (Rheos `price`
      // = the Shopify variant price; `expectedRetailPrice` is an unreliable 2x).
      price: r.price != null ? Number(r.price) : null,
      // Lowercased haystack the picker matches against (name, sku, frame, colors).
      search: [label, r.sku, r.frameName, r.frameColor, r.lensColor].filter(Boolean).join(" ").toLowerCase(),
      inStock: r.quantity > 0,
      onReplen: r.replenishment === "Replenishment",
    };
  });

  return NextResponse.json({ products });
}
