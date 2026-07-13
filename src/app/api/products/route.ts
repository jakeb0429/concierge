import { NextResponse } from "next/server";
import { getCurrentTenant } from "@/lib/tenant";
import { sessionUser } from "@/lib/roles";
import { logger } from "@/lib/log";

/**
 * Orderable product catalog for the Order panel's searchable picker. Proxies to
 * Birdseye's /api/admin/catalog, which merges availability (in stock / on
 * replen, has a Shopify variant) with the LIVE retail price from the website
 * (Shopify), so the MSRP the rep sees is the real store price. Rheos only —
 * Birdseye's catalog is Rheos's.
 */

const BIRDSEYE_URL = process.env.BIRDSEYE_URL || "https://birdseye.scribechs.com";

export async function GET() {
  const tenant = await getCurrentTenant();
  const me = await sessionUser();
  if (!me?.id) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (tenant.slug !== "rheos") return NextResponse.json({ products: [] });

  const secret = process.env.BIRDSEYE_ADMIN_SECRET;
  if (!secret) return NextResponse.json({ products: [], error: "Catalog service not configured." });

  try {
    const res = await fetch(`${BIRDSEYE_URL}/api/admin/catalog`, {
      headers: { "x-admin-secret": secret },
      signal: AbortSignal.timeout(15_000),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(d.products)) return NextResponse.json({ products: d.products });
    logger.error({ status: res.status }, "[products] catalog service returned an error");
  } catch (e) {
    logger.error({ err: e }, "[products] couldn't reach the catalog service");
  }
  return NextResponse.json({ products: [], error: "Couldn't load the product catalog." });
}
