/**
 * Return/exchange eligibility (Phase A — guided returns, no new integrations).
 *
 * Computes a verdict from data we already hold: the customer's order history
 * (window vs the 365-day Saltwater Promise), refund history, channel (B2B
 * routes to wholesale handling), and — when their email has no orders — a
 * related-customer hint so the rep can check for a household purchase.
 *
 * The verdict is decision support for the REP: "eligible" never auto-approves
 * anything, and the facts reach the draft engine as system-computed
 * liveContext lines, never as customer-message text.
 */

import { prisma } from "./db";
import { findRelatedCustomers } from "./related-customers";
import { nowMs } from "./time";

/** Rheos honors returns/exchanges for a full year — the Saltwater Promise. */
export const RETURN_WINDOW_DAYS = 365;
/** This many prior refunded orders flags the account for a human look. */
const REFUND_REVIEW_THRESHOLD = 2;

export type ReturnVerdict = "eligible" | "ineligible" | "review";

/** Where this purchase appears to have happened — drives the guidance the
 *  draft gives the customer (each channel has a different return path). */
export type PurchaseChannel = "rheosgear" | "amazon" | "retail" | "wholesale" | "unknown";

export type ReturnFacts = {
  orderCount: number;
  /** most recent order, when any exist */
  newestRef: string | null;
  newestAt: Date | null;
  daysSinceNewest: number | null;
  refundedCount: number;
  d2cCount: number;
  b2bCount: number;
  /** one-line hint about possible household orders under other emails */
  relatedHint: string | null;
  channel: PurchaseChannel;
  /** how the channel was determined, e.g. "mentioned in the customer's message" */
  channelBasis: string;
  /** retailer/dealer name when the reps recorded one */
  channelName: string | null;
};

/** Amazon order ids look like 111-1234567-1234567. */
const AMAZON_ORDER_ID = /\b\d{3}-\d{7}-\d{7}\b/;

/**
 * Where did this purchase happen? Priority: what the customer's message says
 * (they know where THIS purchase was made) → orders on file → the rep-recorded
 * purchase channel → unknown.
 */
export function detectPurchaseChannel(input: {
  ticketText: string;
  purchaseChannel: string | null;
  channelName: string | null;
  d2cCount: number;
  b2bCount: number;
}): { channel: PurchaseChannel; basis: string } {
  if (/\bamazon\b/i.test(input.ticketText) || AMAZON_ORDER_ID.test(input.ticketText))
    return { channel: "amazon", basis: "mentioned in the customer's message" };
  if (input.d2cCount > 0) return { channel: "rheosgear", basis: "orders on file under this email" };
  if (input.b2bCount > 0) return { channel: "wholesale", basis: "wholesale (B2B) orders on file" };
  if (input.purchaseChannel === "retail" || input.purchaseChannel === "dealer")
    return {
      channel: "retail",
      basis: `rep-recorded purchase channel${input.channelName ? ` (${input.channelName})` : ""}`,
    };
  if (input.purchaseChannel === "direct")
    return { channel: "rheosgear", basis: "rep-recorded purchase channel" };
  return { channel: "unknown", basis: "no order match and no channel on record" };
}

/** Rep-facing guidance per channel — the draft walks the customer through it. */
export function channelGuidance(channel: PurchaseChannel, channelName: string | null): string | null {
  switch (channel) {
    case "amazon":
      return (
        "Purchase appears to be from Amazon. Returns and refunds for Amazon orders are handled " +
        "through the customer's Amazon account (Your Orders, then Return or Replace Items) — we " +
        "cannot process an Amazon refund from here. If this is a warranty claim (Saltwater " +
        "Promise) rather than a return, we handle that directly: ask for proof of purchase. " +
        "Guide the customer through the right path."
      );
    case "retail":
      return (
        `Purchase was made through a retail partner${channelName ? ` (${channelName})` : ""}. ` +
        "Returns and exchanges of retail purchases are handled by the retailer under the store's " +
        "own policy — direct the customer back to the store for a return or size exchange. " +
        "Warranty claims under the Saltwater Promise come to us directly: ask for a receipt or " +
        "proof of purchase."
      );
    case "unknown":
      return (
        "We could not tell where this purchase was made. Ask the customer where they bought " +
        "(rheosgear.com, Amazon, or a retail store) and for an order number or receipt, then " +
        "we can point them down the right return path."
      );
    default:
      return null; // rheosgear/wholesale: the eligibility reasons carry the story
  }
}

export type ReturnEligibility = {
  verdict: ReturnVerdict;
  reasons: string[];
  facts: ReturnFacts;
  /** trusted lines for the draft engine's "Verified live context" section */
  liveContext: string[];
};

const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** Pure rule evaluation — testable without a database. */
export function evaluateReturnEligibility(facts: ReturnFacts): { verdict: ReturnVerdict; reasons: string[] } {
  // Channel first: an Amazon or retail purchase has a different return path
  // regardless of what our own order history says.
  if (facts.channel === "amazon") {
    return {
      verdict: "review",
      reasons: [
        `purchase appears to be from Amazon (${facts.channelBasis}) — returns run through Amazon; warranty claims come to us with proof of purchase`,
      ],
    };
  }
  if (facts.channel === "retail") {
    return {
      verdict: "review",
      reasons: [
        `purchase was through a retail partner${facts.channelName ? ` (${facts.channelName})` : ""} — returns/exchanges go through the retailer; warranty claims come to us with a receipt`,
      ],
    };
  }
  if (facts.orderCount === 0) {
    const reasons = ["no orders found under this email"];
    if (facts.relatedHint) reasons.push(facts.relatedHint);
    reasons.push("verify the purchase with the customer (order number or receipt) before approving");
    return { verdict: "review", reasons };
  }
  if (facts.b2bCount > 0 && facts.d2cCount === 0) {
    return {
      verdict: "review",
      reasons: ["wholesale (B2B) account — handle per the wholesale return policy, not the D2C flow"],
    };
  }
  const days = facts.daysSinceNewest ?? Number.POSITIVE_INFINITY;
  const newest = facts.newestRef && facts.newestAt
    ? `most recent order #${facts.newestRef} placed ${fmtDate(facts.newestAt)} (${facts.daysSinceNewest} days ago)`
    : "most recent order";
  if (days > RETURN_WINDOW_DAYS) {
    return {
      verdict: "ineligible",
      reasons: [`${newest}, outside the ${RETURN_WINDOW_DAYS}-day Saltwater Promise window`],
    };
  }
  if (facts.refundedCount >= REFUND_REVIEW_THRESHOLD) {
    return {
      verdict: "review",
      reasons: [
        `${newest}, inside the ${RETURN_WINDOW_DAYS}-day window`,
        `${facts.refundedCount} previously refunded orders — check the customer read before approving`,
      ],
    };
  }
  return {
    verdict: "eligible",
    reasons: [`${newest}, inside the ${RETURN_WINDOW_DAYS}-day Saltwater Promise window`],
  };
}

/** Renders the verdict + facts as draft-engine liveContext lines. */
export function eligibilityLiveContext(e: { verdict: ReturnVerdict; reasons: string[]; facts: ReturnFacts }): string[] {
  const lines = [
    `Return eligibility (system-computed, rep-confirmed before anything is promised): ${e.verdict.toUpperCase()} — ${e.reasons.join("; ")}.`,
    `Purchase channel: ${e.facts.channel} (${e.facts.channelBasis}).`,
  ];
  const guidance = channelGuidance(e.facts.channel, e.facts.channelName);
  if (guidance) lines.push(`Return-path guidance for this channel: ${guidance}`);
  if (e.facts.orderCount > 0) {
    lines.push(
      `Purchase history relevant to this return: ${e.facts.orderCount} order${e.facts.orderCount === 1 ? "" : "s"} on file` +
        (e.facts.newestRef && e.facts.newestAt
          ? `, most recent #${e.facts.newestRef} on ${fmtDate(e.facts.newestAt)}`
          : "") +
        `; ${e.facts.refundedCount} previously refunded.`
    );
  }
  return lines;
}

/** Fetches the facts and evaluates. `email` may be null (verdict: review). */
export async function checkReturnEligibility(
  customer: {
    email: string | null;
    displayName: string | null;
    purchaseChannel?: string | null;
    channelName?: string | null;
  },
  tenantId: string,
  /** the cleaned inbound thread — used to spot "bought on Amazon" etc. */
  ticketText = ""
): Promise<ReturnEligibility> {
  const email = customer.email?.toLowerCase() ?? null;
  const orders = email
    ? await prisma.customerOrder.findMany({
        where: { email, tenantId },
        orderBy: { orderedAt: "desc" },
        select: {
          orderRef: true, orderedAt: true, totalAmount: true, refunded: true, source: true,
          email: true, buyerName: true, shipName: true, shipAddress1: true, shipZip: true,
        },
      })
    : [];

  let relatedHint: string | null = null;
  if (!orders.length && email) {
    const related = await findRelatedCustomers(customer, tenantId, []).catch(() => []);
    if (related.length) {
      const top = related[0];
      relatedHint =
        `possible household match under ${top.email}` +
        (top.name ? ` (${top.name})` : "") +
        `, ${top.orderCount} order${top.orderCount === 1 ? "" : "s"}, most recent ${fmtDate(top.lastOrderedAt)}`;
    }
  }

  const newest = orders[0] ?? null;
  const d2cCount = orders.filter((o) => o.source !== "hubspot-b2b").length;
  const b2bCount = orders.filter((o) => o.source === "hubspot-b2b").length;
  const detected = detectPurchaseChannel({
    ticketText,
    purchaseChannel: customer.purchaseChannel ?? null,
    channelName: customer.channelName ?? null,
    d2cCount,
    b2bCount,
  });
  const facts: ReturnFacts = {
    orderCount: orders.length,
    newestRef: newest?.orderRef ?? null,
    newestAt: newest?.orderedAt ?? null,
    daysSinceNewest: newest ? Math.floor((nowMs() - newest.orderedAt.getTime()) / 86_400_000) : null,
    refundedCount: orders.filter((o) => o.refunded).length,
    d2cCount,
    b2bCount,
    relatedHint,
    channel: detected.channel,
    channelBasis: detected.basis,
    channelName: customer.channelName ?? null,
  };
  const { verdict, reasons } = evaluateReturnEligibility(facts);
  return { verdict, reasons, facts, liveContext: eligibilityLiveContext({ verdict, reasons, facts }) };
}
