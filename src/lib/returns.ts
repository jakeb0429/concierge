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
};

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
  ];
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
  customer: { email: string | null; displayName: string | null },
  tenantId: string
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
  const facts: ReturnFacts = {
    orderCount: orders.length,
    newestRef: newest?.orderRef ?? null,
    newestAt: newest?.orderedAt ?? null,
    daysSinceNewest: newest ? Math.floor((nowMs() - newest.orderedAt.getTime()) / 86_400_000) : null,
    refundedCount: orders.filter((o) => o.refunded).length,
    d2cCount: orders.filter((o) => o.source !== "hubspot-b2b").length,
    b2bCount: orders.filter((o) => o.source === "hubspot-b2b").length,
    relatedHint,
  };
  const { verdict, reasons } = evaluateReturnEligibility(facts);
  return { verdict, reasons, facts, liveContext: eligibilityLiveContext({ verdict, reasons, facts }) };
}
