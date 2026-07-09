/**
 * Related-customer discovery — finds orders that likely belong to the same
 * person or household when nothing matches the customer's own email:
 *
 *   - email    : another order email contains the customer's last name
 *                ("Kristoffer Langlie" → klanglie21@gmail.com)
 *   - name     : the buyer or ship-to name on someone else's order shares the
 *                last name (family member, or a gift shipped to our customer)
 *   - address  : an order under a different email ships to the same
 *                address+zip as one of the customer's own orders
 *
 * Heuristic by design: results are rep-facing "possible matches" with the
 * reason shown, never merged automatically and never fed to drafts as fact.
 */

import { prisma } from "./db";

export type MatchReason = "address" | "name" | "email";

export type RelatedCandidate = {
  email: string;
  /** best display name seen on the candidate's orders */
  name: string | null;
  reasons: MatchReason[];
  orderCount: number;
  ltv: number;
  lastOrderedAt: Date;
  /** Customer row for that email, when one exists (links to their profile) */
  customerId: string | null;
};

/** Orders rows the matcher consumes (subset of CustomerOrder). */
export type OrderIdentity = {
  email: string;
  orderedAt: Date;
  totalAmount: unknown; // Prisma Decimal | number
  buyerName: string | null;
  shipName: string | null;
  shipAddress1: string | null;
  shipZip: string | null;
};

/** A surname matching >25 distinct emails is too common to be a signal. */
const TOO_COMMON = 25;
const MAX_RESULTS = 8;
const REASON_WEIGHT: Record<MatchReason, number> = { address: 4, name: 2, email: 1 };

/** Last word of the display name, letters only, ≥3 chars — else null. */
export function lastNameOf(displayName: string | null | undefined): string | null {
  const words = (displayName ?? "").trim().split(/\s+/).filter(Boolean);
  const last = words.length >= 2 ? words[words.length - 1] : null;
  if (!last) return null;
  const clean = last.replace(/[^\p{L}'-]/gu, "");
  return clean.length >= 3 ? clean.toLowerCase() : null;
}

/** "123 Main St." + "29401-1234" → "123mainst|29401" (5-digit zip). */
export function addressKey(address1: string | null | undefined, zip: string | null | undefined): string | null {
  const addr = (address1 ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const z = (zip ?? "").trim().slice(0, 5);
  return addr && z ? `${addr}|${z}` : null;
}

/** Case-insensitive whole-word test — "Langlie" in "Kris Langlie", not "Smith" in "Smithson". */
function hasWord(haystack: string | null, word: string): boolean {
  if (!haystack) return false;
  return new RegExp(`(^|[^\\p{L}])${word}($|[^\\p{L}])`, "iu").test(haystack);
}

/**
 * Pure core: given the customer's identity, their own orders, and coarse
 * candidate order rows, group by email and attach match reasons.
 */
export function rankCandidates(
  customer: { email: string; lastName: string | null },
  ownOrders: OrderIdentity[],
  candidates: OrderIdentity[]
): RelatedCandidate[] {
  const ownEmail = customer.email.toLowerCase();
  const ownKeys = new Set(ownOrders.map((o) => addressKey(o.shipAddress1, o.shipZip)).filter(Boolean));

  type Agg = { reasons: Set<MatchReason>; orders: OrderIdentity[] };
  const byEmail = new Map<string, Agg>();

  for (const o of candidates) {
    const email = o.email.toLowerCase();
    if (email === ownEmail) continue;

    const reasons = new Set<MatchReason>();
    if (ownKeys.has(addressKey(o.shipAddress1, o.shipZip))) reasons.add("address");
    if (customer.lastName) {
      if (hasWord(o.shipName, customer.lastName) || hasWord(o.buyerName, customer.lastName)) reasons.add("name");
      if (customer.lastName.length >= 4 && email.split("@")[0].includes(customer.lastName)) reasons.add("email");
    }
    if (!reasons.size) continue;

    const agg = byEmail.get(email) ?? { reasons: new Set<MatchReason>(), orders: [] };
    reasons.forEach((r) => agg.reasons.add(r));
    agg.orders.push(o);
    byEmail.set(email, agg);
  }

  // A too-common surname (dozens of unrelated Smiths) stops being a signal —
  // keep only candidates that also share an address.
  const nameOnly = [...byEmail.values()].filter((a) => !a.reasons.has("address")).length;
  if (nameOnly > TOO_COMMON) {
    for (const [email, agg] of byEmail) if (!agg.reasons.has("address")) byEmail.delete(email);
  }

  const ranked = [...byEmail.entries()].map(([email, agg]) => {
    const sorted = [...agg.orders].sort((a, b) => b.orderedAt.getTime() - a.orderedAt.getTime());
    const newest = sorted[0];
    return {
      email,
      name: newest.buyerName ?? newest.shipName ?? null,
      reasons: [...agg.reasons].sort((a, b) => REASON_WEIGHT[b] - REASON_WEIGHT[a]),
      orderCount: agg.orders.length,
      ltv: agg.orders.reduce((s, o) => s + Number(o.totalAmount), 0),
      lastOrderedAt: newest.orderedAt,
      customerId: null as string | null,
    };
  });
  ranked.sort((a, b) => {
    const wa = a.reasons.reduce((s, r) => s + REASON_WEIGHT[r], 0);
    const wb = b.reasons.reduce((s, r) => s + REASON_WEIGHT[r], 0);
    return wb - wa || b.ltv - a.ltv;
  });
  return ranked.slice(0, MAX_RESULTS);
}

const ORDER_IDENTITY_SELECT = {
  email: true, orderedAt: true, totalAmount: true,
  buyerName: true, shipName: true, shipAddress1: true, shipZip: true,
} as const;

/**
 * Find possible related customers/orders for a customer profile.
 * `ownOrders` are the profile's already-loaded orders (avoids a refetch).
 */
export async function findRelatedCustomers(
  customer: { email: string | null; displayName: string | null },
  tenantId: string,
  ownOrders: OrderIdentity[]
): Promise<RelatedCandidate[]> {
  const email = customer.email?.toLowerCase();
  if (!email) return [];
  const lastName = lastNameOf(customer.displayName);

  const or: object[] = [];
  if (lastName) {
    or.push({ shipName: { contains: lastName, mode: "insensitive" } });
    or.push({ buyerName: { contains: lastName, mode: "insensitive" } });
    if (lastName.length >= 4) or.push({ email: { contains: lastName } });
  }
  // startsWith so a stored ZIP+4 ("29401-1234") still hits the 5-digit key
  const ownZips = [...new Set(ownOrders.map((o) => (o.shipZip ?? "").trim().slice(0, 5)).filter(Boolean))];
  for (const z of ownZips.slice(0, 10)) or.push({ shipZip: { startsWith: z } });
  if (!or.length) return [];

  const candidates = await prisma.customerOrder.findMany({
    where: { tenantId, email: { not: email }, OR: or },
    select: ORDER_IDENTITY_SELECT,
    take: 2_000, // sanity cap; rankCandidates prunes to MAX_RESULTS
  });

  const ranked = rankCandidates({ email, lastName }, ownOrders, candidates);
  if (!ranked.length) return ranked;

  // Link candidates that already have a Customer profile.
  const profiles = await prisma.customer.findMany({
    where: { tenantId, email: { in: ranked.map((r) => r.email) } },
    select: { id: true, email: true },
  });
  const byEmail = new Map(profiles.map((p) => [p.email!.toLowerCase(), p.id]));
  for (const r of ranked) r.customerId = byEmail.get(r.email) ?? null;
  return ranked;
}
