import { prisma } from "@/lib/db";
import { clusterEmails } from "@/lib/customer-links";

/**
 * Rep-confirmed ticket↔order links, plus the lookup that proposes candidates
 * from the customer profile (identity cluster emails first, then name match).
 * Works for both order shapes: Stingray boat registrations (orderRef = hull
 * id, description carries the boat line) and commerce orders (orderRef =
 * order number, totalAmount carries the value).
 */

export type LinkedOrder = {
  linkId: string;
  orderId: string;
  orderRef: string;
  source: string;
  orderedAt: Date;
  totalAmount: number;
  description: string | null;
  buyerName: string | null;
  via: string;
};

export type OrderCandidate = {
  orderId: string;
  orderRef: string;
  source: string;
  orderedAt: Date;
  totalAmount: number;
  description: string | null;
  buyerName: string | null;
  email: string;
  confidence: "email" | "name";
};

const ORDER_SELECT = {
  id: true,
  orderRef: true,
  source: true,
  orderedAt: true,
  totalAmount: true,
  description: true,
  buyerName: true,
  email: true,
} as const;

type OrderRow = {
  id: string;
  orderRef: string;
  source: string;
  orderedAt: Date;
  totalAmount: unknown;
  description: string | null;
  buyerName: string | null;
  email: string;
};

export async function linkedOrders(ticketId: string): Promise<LinkedOrder[]> {
  const rows = await prisma.ticketOrder.findMany({
    where: { ticketId },
    include: { order: { select: ORDER_SELECT } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    linkId: r.id,
    orderId: r.order.id,
    orderRef: r.order.orderRef,
    source: r.order.source,
    orderedAt: r.order.orderedAt,
    totalAmount: Number(r.order.totalAmount),
    description: r.order.description,
    buyerName: r.order.buyerName,
    via: r.via,
  }));
}

/** Find an order by what a rep would paste: order #, hull id, or a hull with
 *  separators/case noise. Exact ref match first, then normalized-prefix. */
export async function findOrdersByRef(tenantId: string, refRaw: string): Promise<OrderRow[]> {
  const ref = refRaw.trim();
  if (!ref) return [];
  const norm = ref.replace(/[^a-zA-Z0-9/]/g, "").toUpperCase();
  const rows = await prisma.customerOrder.findMany({
    where: {
      tenantId,
      OR: [
        { orderRef: { equals: ref, mode: "insensitive" } },
        { orderRef: { equals: norm, mode: "insensitive" } },
        ...(norm.length >= 6 ? [{ orderRef: { startsWith: norm, mode: "insensitive" as const } }] : []),
      ],
    },
    select: ORDER_SELECT,
    orderBy: { orderedAt: "desc" },
    take: 5,
  });
  return rows;
}

/** Candidates for the "look up from customer profile" button: every order
 *  under the cluster's emails (confidence "email"), then buyerName matches on
 *  the customer's name tokens (confidence "name" — verify before trusting). */
export async function lookupCandidates(
  tenantId: string,
  customerId: string,
  displayName: string | null,
  excludeOrderIds: string[] = []
): Promise<OrderCandidate[]> {
  const emails = await clusterEmails(customerId);
  const byEmail: OrderRow[] = emails.length
    ? await prisma.customerOrder.findMany({
        where: { tenantId, email: { in: emails }, id: { notIn: excludeOrderIds } },
        select: ORDER_SELECT,
        orderBy: { orderedAt: "desc" },
        take: 25,
      })
    : [];
  const seen = new Set([...excludeOrderIds, ...byEmail.map((o) => o.id)]);

  const tokens = (displayName ?? "")
    .toLowerCase()
    .replace(/[^a-z ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  let byName: OrderRow[] = [];
  if (tokens.length >= 2) {
    byName = (
      await prisma.customerOrder.findMany({
        where: {
          tenantId,
          AND: tokens.map((t) => ({ buyerName: { contains: t, mode: "insensitive" as const } })),
        },
        select: ORDER_SELECT,
        orderBy: { orderedAt: "desc" },
        take: 15,
      })
    ).filter((o) => !seen.has(o.id));
  }

  const shape = (o: OrderRow, confidence: "email" | "name"): OrderCandidate => ({
    orderId: o.id,
    orderRef: o.orderRef,
    source: o.source,
    orderedAt: o.orderedAt,
    totalAmount: Number(o.totalAmount),
    description: o.description,
    buyerName: o.buyerName,
    email: o.email,
    confidence,
  });
  return [...byEmail.map((o) => shape(o, "email")), ...byName.map((o) => shape(o, "name"))];
}
