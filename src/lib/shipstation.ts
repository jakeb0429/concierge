/**
 * ShipStation order context (V1 API, Basic auth — same creds rheos-inventory
 * uses for order creation). Read-only here: the ticket workspace and draft
 * grounding get "when it was placed / when it shipped / carrier + tracking".
 * Cached in-process (10 min) so page loads and drafts don't hammer the API.
 */

const SS_V1 = "https://ssapi.shipstation.com";
const TTL = 10 * 60_000;

export type OrderContext = {
  orderNumber: string;
  orderDate: string;
  orderStatus: string; // awaiting_payment | awaiting_shipment | shipped | on_hold | cancelled
  shipDate: string | null;
  carrier: string | null;
  trackingNumber: string | null;
};

type SSOrder = {
  orderNumber: string;
  orderDate: string;
  orderStatus: string;
};
type SSShipment = {
  shipDate: string;
  trackingNumber: string | null;
  carrierCode: string | null;
  voided: boolean;
};

const cache = new Map<string, { at: number; data: OrderContext[] }>();

function auth(): string | null {
  const key = process.env.SHIPSTATION_API_KEY;
  const secret = process.env.SHIPSTATION_API_SECRET;
  if (!key || !secret) return null;
  return `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`;
}

async function ss<T>(path: string): Promise<T | null> {
  const a = auth();
  if (!a) return null;
  try {
    const res = await fetch(`${SS_V1}${path}`, {
      headers: { Authorization: a, Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null; // fail-soft: order context is a bonus, never a blocker
  }
}

/** Most recent orders (and their shipments) for a customer email. */
export async function getOrderContext(email: string | null | undefined, limit = 2): Promise<OrderContext[]> {
  if (!email) return [];
  const key = email.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;

  const orders = await ss<{ orders: SSOrder[] }>(
    `/orders?customerEmail=${encodeURIComponent(key)}&sortBy=OrderDate&sortDir=DESC&pageSize=${limit}`
  );
  const out: OrderContext[] = [];
  for (const o of orders?.orders?.slice(0, limit) ?? []) {
    let shipment: SSShipment | null = null;
    if (o.orderStatus === "shipped") {
      const ships = await ss<{ shipments: SSShipment[] }>(
        `/shipments?orderNumber=${encodeURIComponent(o.orderNumber)}&pageSize=3`
      );
      shipment = ships?.shipments?.find((s) => !s.voided) ?? null;
    }
    out.push({
      orderNumber: o.orderNumber,
      orderDate: o.orderDate,
      orderStatus: o.orderStatus,
      shipDate: shipment?.shipDate ?? null,
      carrier: shipment?.carrierCode ?? null,
      trackingNumber: shipment?.trackingNumber ?? null,
    });
  }
  cache.set(key, { at: Date.now(), data: out });
  return out;
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;

/** Public tracking link per carrier, when we can build one. */
export function trackingUrl(carrier: string | null, trackingNumber: string | null): string | null {
  if (!trackingNumber) return null;
  const c = (carrier ?? "").toLowerCase();
  if (c.includes("usps") || c.includes("stamps")) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`;
  if (c.includes("ups")) return `https://www.ups.com/track?tracknum=${trackingNumber}`;
  if (c.includes("fedex")) return `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}`;
  if (c.includes("dhl")) return `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${trackingNumber}`;
  return null;
}

/** One-line-per-order summary for draft grounding and internal display. */
export function orderContextLines(orders: OrderContext[]): string[] {
  return orders.map((o) => {
    const parts = [`Order ${o.orderNumber}: placed ${fmtDate(o.orderDate)}`];
    if (o.orderStatus === "shipped") {
      parts.push(`shipped ${fmtDate(o.shipDate) ?? "(date unknown)"}${o.carrier ? ` via ${o.carrier.toUpperCase()}` : ""}`);
      if (o.trackingNumber) parts.push(`tracking ${o.trackingNumber}`);
    } else {
      parts.push(`status: ${o.orderStatus.replace(/_/g, " ")}`);
    }
    return parts.join(" · ");
  });
}
