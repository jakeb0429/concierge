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
  email: string | null | undefined,
  tenantId: string,
  limit = 5
): Promise<BoatRow[]> {
  const key = email?.trim().toLowerCase();
  if (!key) return [];
  return prisma.customerOrder.findMany({
    where: { email: key, tenantId, source: DEALER_NETWORK_SOURCE },
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
