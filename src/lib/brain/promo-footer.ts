/**
 * Sun Collective membership promo appended to Exchange and Warranty reply
 * drafts, to convert service contacts into members.
 *
 * Copy is kept in sync with the REAL offer in Birdseye
 * (rheos-inventory/src/lib/sun-collective-perks.ts, verified 2026-07-12):
 * $5/month, 50% off every pair forever, free premium travel case with the
 * first order, 2-year VIP warranty, early access. To reword or switch the
 * promo off, edit HERE (single source) — PROMO_CATEGORIES gates which reply
 * types get it.
 *
 * Deterministic on purpose (not left to the model), so it reliably appears
 * on every eligible draft; the rep still sees it in the draft and can edit
 * or delete it before sending. No em dashes — customer replies scrub them.
 */

// Ticket categories (see src/lib/categories.ts) that carry the promo.
const PROMO_CATEGORIES = new Set(["returns_exchange", "warranty"]);

const JOIN_URL = "https://www.rheosgear.com/products/sun-collective-1m";

export const SUN_COLLECTIVE_FOOTER =
  "P.S. Did you know Sun Collective members get 50% off every Rheos pair, forever, " +
  "plus a free premium travel case on your first order, a 2-year VIP warranty, and early " +
  `access to new drops? It is just $5 a month, cancel anytime. Join here: ${JOIN_URL}`;

export function promoFooterForCategory(category: string | null | undefined): string | null {
  return category && PROMO_CATEGORIES.has(category) ? SUN_COLLECTIVE_FOOTER : null;
}

/**
 * Remove a previously-appended canonical footer (and the blank line before
 * it) from a body. Used on the prior draft before it is fed back to the model
 * on regeneration, so the model never sees — and cannot paraphrase — the
 * promo, and again before re-appending so the footer never stacks.
 */
export function stripPromoFooter(body: string): string {
  const idx = body.indexOf(SUN_COLLECTIVE_FOOTER);
  return idx === -1 ? body : body.slice(0, idx).trimEnd();
}

/**
 * Append the category's promo footer to a draft body. Strip-then-append, so
 * the result always ends in exactly one CANONICAL footer for eligible
 * categories (a regenerated body that already carried a footer, canonical or
 * model-mangled, is normalized), and any stale footer is removed when the
 * category is no longer eligible.
 */
export function appendPromoFooter(body: string, category: string | null | undefined): string {
  const cleaned = stripPromoFooter(body);
  const footer = promoFooterForCategory(category);
  if (!footer) return cleaned;
  return `${cleaned.trimEnd()}\n\n${footer}`;
}
