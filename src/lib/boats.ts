import { prisma } from "@/lib/db";

/**
 * Registered-boat lookup (Stingray dealer-network records).
 *
 * Boats imported from DealersCircle live as CustomerOrder rows with
 * source "dealers-circle": orderRef = hull id, description = the human line
 * ("2021 236CC · Hull PNYUS0KRB121 · delivered May 22, 2021 via Memphis Boat
 * Center · original owner"). Tenants without that source simply get [].
 */

export const DEALER_NETWORK_SOURCE = "dealers-circle";

export type BoatRow = {
  orderRef: string;
  orderedAt: Date;
  description: string | null;
};

export async function getRegisteredBoats(
  email: string | null | undefined | (string | null | undefined)[],
  tenantId: string,
  limit = 5
): Promise<BoatRow[]> {
  const keys = [...new Set(
    (Array.isArray(email) ? email : [email])
      .map((e) => e?.trim().toLowerCase())
      .filter((e): e is string => !!e)
  )];
  if (!keys.length) return [];
  return prisma.customerOrder.findMany({
    where: { email: { in: keys }, tenantId, source: DEALER_NETWORK_SOURCE },
    orderBy: { orderedAt: "desc" },
    take: limit,
    select: { orderRef: true, orderedAt: true, description: true },
  });
}

/**
 * Name-based fallback for senders writing from a different address than the
 * one on their registration (both real matches in the first live ticket batch
 * did exactly that). Every name token must appear in buyerName — order-free,
 * so "Matt Shelton" finds "Shelton, Matt". Callers must present results as
 * unconfirmed ("registration under this name") — never as the sender's own.
 */
export async function getRegisteredBoatsByName(
  displayName: string | null | undefined,
  tenantId: string,
  limit = 3
): Promise<BoatRow[]> {
  const tokens = (displayName ?? "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length >= 2);
  // A single token ("Melissa") matches far too many strangers — require two.
  if (tokens.length < 2 || tokens.length > 5) return [];
  return prisma.customerOrder.findMany({
    where: {
      tenantId,
      source: DEALER_NETWORK_SOURCE,
      AND: tokens.map((t) => ({ buyerName: { contains: t, mode: "insensitive" as const } })),
    },
    orderBy: { orderedAt: "desc" },
    take: limit,
    select: { orderRef: true, orderedAt: true, description: true },
  });
}

const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** One line per boat for draft grounding and internal display. */
export function boatContextLines(rows: BoatRow[]): string[] {
  return rows.map((r) =>
    r.description
      ? `${r.description} (registered ${fmtDate(r.orderedAt)})`
      : `Hull ${r.orderRef} (registered ${fmtDate(r.orderedAt)})`
  );
}
