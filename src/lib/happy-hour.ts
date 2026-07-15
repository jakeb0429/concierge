import { z } from "zod";
import { prisma } from "./db";
import { logger } from "./log";

/**
 * Happy hour — Charleston & Mount Pleasant. The morning digest's local widget:
 * the daily scan cron (prisma/happy-hour-scan.ts) asks Claude + web search for
 * freshly announced deals (the motivating example: The Grocery posting a $5
 * martini and half-off appetizers on Instagram) plus standing happy hours, and
 * upserts them here. This module owns the pure logic — parsing/validating the
 * model's JSON, the dedupe key, freshness windows — and the widget's read.
 */

export const HAPPY_HOUR_AREAS = ["Charleston", "Mount Pleasant"] as const;
export type HappyHourArea = (typeof HAPPY_HOUR_AREAS)[number];
export type HappyHourKind = "special" | "recurring";

export type ParsedSpecial = {
  dedupeKey: string;
  venue: string;
  area: HappyHourArea;
  deal: string;
  details: string | null;
  kind: HappyHourKind;
  source: string | null;
  sourceUrl: string | null;
};

/** A freshly announced special stays on the board a week; a standing happy
 *  hour survives a few missed scans before it drops off. */
export const FRESH_DAYS: Record<HappyHourKind, number> = { special: 7, recurring: 28 };

export function isFresh(kind: string, lastSeenAt: Date, now: Date = new Date()): boolean {
  const days = FRESH_DAYS[kind === "special" ? "special" : "recurring"];
  return now.getTime() - lastSeenAt.getTime() <= days * 86_400_000;
}

/** Idempotency key: same venue + same deal = same row, however the model
 *  capitalizes or punctuates it on a given day. */
export function dedupeKey(venue: string, deal: string): string {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, "-");
  return `${norm(venue)}|${norm(deal)}`;
}

/** Map whatever the model wrote ("Mt. Pleasant", "downtown Charleston") onto
 *  the two areas we cover; anything else is out of scope and dropped. */
export function normalizeArea(raw: string): HappyHourArea | null {
  if (/\bm(?:t|oun)t?\.?\s*pleasant\b/i.test(raw)) return "Mount Pleasant";
  if (/\bcharleston\b/i.test(raw)) return "Charleston";
  return null;
}

const specialSchema = z.object({
  venue: z.string().trim().min(1).max(80),
  area: z.string().trim().min(1),
  deal: z.string().trim().min(1).max(160),
  details: z.string().trim().max(400).nullish(),
  kind: z.string().nullish(),
  source: z.string().trim().max(160).nullish(),
  sourceUrl: z.string().trim().max(300).nullish(),
});

const payloadSchema = z.object({ specials: z.array(z.unknown()) });

/**
 * Extract the scan's deal list from the model's final text. The prompt asks
 * for one fenced ```json block; we take the LAST one (or the last bare JSON
 * object as a fallback), validate each entry independently, and drop anything
 * malformed or outside the two areas — a bad entry never sinks the batch.
 */
export function parseSpecials(text: string): ParsedSpecial[] {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  const candidates = fenced.length ? fenced : [text.slice(text.indexOf("{"))];

  let items: unknown[] | null = null;
  for (const candidate of candidates.reverse()) {
    try {
      const parsed = payloadSchema.safeParse(JSON.parse(candidate));
      if (parsed.success) {
        items = parsed.data.specials;
        break;
      }
    } catch {
      // not JSON — try the next candidate
    }
  }
  if (!items) return [];

  const out: ParsedSpecial[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const res = specialSchema.safeParse(item);
    if (!res.success) continue;
    const area = normalizeArea(res.data.area);
    if (!area) continue;
    const key = dedupeKey(res.data.venue, res.data.deal);
    if (seen.has(key)) continue;
    seen.add(key);
    const sourceUrl = res.data.sourceUrl && /^https?:\/\//i.test(res.data.sourceUrl) ? res.data.sourceUrl : null;
    out.push({
      dedupeKey: key,
      venue: res.data.venue,
      area,
      deal: res.data.deal,
      details: res.data.details || null,
      kind: res.data.kind === "special" ? "special" : "recurring",
      source: res.data.source || null,
      sourceUrl,
    });
  }
  return out;
}

export type HappyHourItem = {
  id: string;
  venue: string;
  area: string;
  deal: string;
  details: string | null;
  kind: string;
  source: string | null;
  sourceUrl: string | null;
  lastSeenAt: Date;
};

/**
 * The widget's read: active rows still inside their freshness window, fresh
 * announcements first. Fail-soft — the digest never breaks over a fun widget.
 */
export async function getHappyHourSpecials(limit = 8, now: Date = new Date()): Promise<HappyHourItem[]> {
  try {
    const oldest = new Date(now.getTime() - FRESH_DAYS.recurring * 86_400_000);
    const rows = await prisma.happyHourSpecial.findMany({
      where: { active: true, lastSeenAt: { gte: oldest } },
      orderBy: { lastSeenAt: "desc" },
      take: 50,
    });
    return rows
      .filter((r) => isFresh(r.kind, r.lastSeenAt, now))
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "special" ? -1 : 1;
        if (a.kind === "special") return b.lastSeenAt.getTime() - a.lastSeenAt.getTime();
        return a.venue.localeCompare(b.venue);
      })
      .slice(0, limit);
  } catch (err) {
    logger.warn({ err }, "happy-hour read failed; widget renders empty");
    return [];
  }
}
