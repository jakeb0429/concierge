import { logger } from "./log";

/**
 * Order → Shopify checkout link. Birdseye owns the Shopify credentials and the
 * draft-order logic (POST /api/admin/checkout-link); we call it server-to-server
 * with the shared admin secret and hand back the one-click invoiceUrl the rep
 * drops into the reply. Bounded fetch, never bare (per the standards doc).
 */

const BIRDSEYE_URL = process.env.BIRDSEYE_URL || "https://birdseye.scribechs.com";

export interface CheckoutDiscount {
  value: number;
  valueType: "PERCENTAGE" | "FIXED_AMOUNT";
  title?: string;
}

export interface CheckoutItem {
  /** Catalog line: a Shopify SKU. */
  sku?: string;
  /** Custom line (no SKU): a non-catalog charge like a $6 replacement arm. */
  title?: string;
  price?: string; // decimal string, e.g. "6.00" — required with `title`
  quantity: number;
  /** Per-line discount (vs the order-level one). */
  discount?: CheckoutDiscount;
}

export interface CheckoutResult {
  invoiceUrl: string;
  name: string;
  totalPrice: string;
  /** SKUs that didn't resolve to a Shopify variant (order built from the rest). */
  notFound: string[];
}

export async function createCheckoutLink(params: {
  items: CheckoutItem[];
  email: string;
  note?: string;
  discount?: CheckoutDiscount;
  tags?: string[];
}): Promise<CheckoutResult> {
  const secret = process.env.BIRDSEYE_ADMIN_SECRET;
  if (!secret) throw new Error("Order service is not configured (missing BIRDSEYE_ADMIN_SECRET).");

  let res: Response;
  try {
    res = await fetch(`${BIRDSEYE_URL}/api/admin/checkout-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    logger.error({ err: e }, "[order] checkout-link request failed to reach Birdseye");
    throw new Error("Could not reach the order service. Please try again.");
  }

  const data = (await res.json().catch(() => ({}))) as Partial<CheckoutResult> & { ok?: boolean; error?: string };
  if (!res.ok || !data.ok || !data.invoiceUrl) {
    logger.error({ status: res.status, error: data.error }, "[order] checkout-link returned an error");
    const err = new Error(data.error || `Order service error (${res.status}).`) as Error & { upstreamStatus?: number };
    // Carry the upstream status so the route can distinguish a rep/input problem
    // (4xx — e.g. an unresolved SKU) from a real service outage (5xx).
    err.upstreamStatus = res.status;
    throw err;
  }
  return {
    invoiceUrl: data.invoiceUrl,
    name: data.name ?? "",
    totalPrice: data.totalPrice ?? "",
    notFound: data.notFound ?? [],
  };
}
