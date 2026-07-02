import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const CATEGORY_LABELS: Record<string, string> = {
  warranty: "Warranty",
  replacement_parts: "Replacement parts",
  shipping_order_status: "Shipping / order status",
  returns_exchange: "Returns / exchange",
  product_question: "Product questions",
  sizing_fit: "Sizing / fit",
  wholesale: "Wholesale",
  vendor_pitch: "Vendor pitches",
  marketing_collab: "Marketing / collabs",
  automated_notification: "Automated",
  other: "Other",
};

/** Machine mail + people selling TO Rheos — excluded from customer-experience views. */
const NOISE = ["automated_notification", "vendor_pitch"];

const SENTIMENT_STYLE: Record<string, string> = {
  positive: "bg-green-500",
  neutral: "bg-neutral-300",
  unresolved: "bg-amber-400",
  negative: "bg-red-400",
};

const BUCKETS = [
  { label: "≤ 30d", min: 0, max: 30 },
  { label: "31–90d", min: 31, max: 90 },
  { label: "91–180d", min: 91, max: 180 },
  { label: "181–365d", min: 181, max: 365 },
  { label: "1–2y", min: 366, max: 730 },
  { label: "2y+", min: 731, max: Infinity },
];
function bucketOf(dsp: number | null): string | null {
  if (dsp == null) return null;
  return BUCKETS.find((b) => dsp >= b.min && dsp <= b.max)?.label ?? null;
}

type Inq = {
  id: string;
  category: string;
  endSentiment: string;
  threadCreatedAt: Date;
  daysSincePurchase: number | null;
  fromEmail: string | null;
};

const DIMS: Record<string, { label: string; of: (q: Inq) => string | null; values: (qs: Inq[]) => string[] }> = {
  bucket: {
    label: "Time since purchase",
    of: (q) => bucketOf(q.daysSincePurchase),
    values: () => BUCKETS.map((b) => b.label),
  },
  category: {
    label: "Category",
    of: (q) => q.category,
    values: (qs) => [...new Set(qs.map((q) => q.category))].sort((a, b) => qs.filter((x) => x.category === b).length - qs.filter((x) => x.category === a).length),
  },
  sentiment: {
    label: "Outcome sentiment",
    of: (q) => q.endSentiment,
    values: () => ["positive", "neutral", "unresolved", "negative"],
  },
};

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1]} ${y.slice(2)}`;
}
const fmtDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });

export default async function Analytics({
  searchParams,
}: {
  searchParams: Promise<{ x?: string; y?: string; xv?: string; yv?: string }>;
}) {
  const tenant = await getCurrentTenant();
  const sp = await searchParams;
  const xDim = DIMS[sp.x ?? ""] ? sp.x! : "bucket";
  const yDim = DIMS[sp.y ?? ""] && sp.y !== xDim ? sp.y! : xDim === "category" ? "sentiment" : "category";
  const since = new Date(Date.now() - 365 * 24 * 3600 * 1000);

  const [inquiriesAll, sales] = await Promise.all([
    prisma.analyticsInquiry.findMany({
      where: { tenantId: tenant.id, threadCreatedAt: { gte: since } },
      select: { id: true, category: true, endSentiment: true, threadCreatedAt: true, daysSincePurchase: true, fromEmail: true },
      orderBy: { threadCreatedAt: "desc" },
    }),
    prisma.salesMonthly.findMany({ orderBy: { month: "asc" } }),
  ]);
  const real = inquiriesAll.filter((q) => !NOISE.includes(q.category));

  // Top-line aggregations
  const byCategory = new Map<string, number>();
  const byMonth = new Map<string, number>();
  for (const q of inquiriesAll) {
    byCategory.set(q.category, (byCategory.get(q.category) ?? 0) + 1);
    byMonth.set(monthKey(q.threadCreatedAt), (byMonth.get(monthKey(q.threadCreatedAt)) ?? 0) + 1);
  }
  const bySentiment = new Map<string, number>();
  const dsp: number[] = [];
  for (const q of real) {
    bySentiment.set(q.endSentiment, (bySentiment.get(q.endSentiment) ?? 0) + 1);
    if (q.daysSincePurchase != null) dsp.push(q.daysSincePurchase);
  }
  const categories = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
  const maxCat = categories[0]?.[1] ?? 1;
  const sentimentTotal = [...bySentiment.values()].reduce((a, b) => a + b, 0) || 1;

  const months: string[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) months.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  const salesByMonth = new Map<string, { orders: number; revenue: number }>();
  for (const s of sales) {
    const k = monthKey(s.month);
    const cur = salesByMonth.get(k) ?? { orders: 0, revenue: 0 };
    salesByMonth.set(k, { orders: cur.orders + s.orders, revenue: cur.revenue + Number(s.revenue) });
  }
  const maxInq = Math.max(1, ...months.map((m) => byMonth.get(m) ?? 0));
  const maxRev = Math.max(1, ...months.map((m) => salesByMonth.get(m)?.revenue ?? 0));

  const histo = BUCKETS.map((b) => ({ ...b, n: dsp.filter((d) => d >= b.min && d <= b.max).length }));
  const maxBucket = Math.max(1, ...histo.map((b) => b.n));
  const medianDsp = dsp.length ? [...dsp].sort((a, b) => a - b)[Math.floor(dsp.length / 2)] : null;
  const noiseCount = inquiriesAll.length - real.length;

  // Cross-tab over REAL inquiries
  const X = DIMS[xDim];
  const Y = DIMS[yDim];
  const xVals = X.values(real).filter((v) => real.some((q) => X.of(q) === v));
  const yVals = Y.values(real).filter((v) => real.some((q) => Y.of(q) === v));
  const cell = (xv: string, yv: string) => real.filter((q) => X.of(q) === xv && Y.of(q) === yv).length;
  const rowTotal = (xv: string) => real.filter((q) => X.of(q) === xv).length;
  const label = (dim: string, v: string) => (dim === "category" ? (CATEGORY_LABELS[v] ?? v) : v);

  // Drill list
  const drill =
    sp.xv || sp.yv
      ? real
          .filter((q) => (!sp.xv || X.of(q) === sp.xv) && (!sp.yv || Y.of(q) === sp.yv))
          .slice(0, 50)
      : null;

  const explore = (x: string, y: string, extra = "") => `/analytics?x=${x}&y=${y}${extra}#explore`;

  return (
    <div>
      <div className="mb-5 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Analytics</h1>
        <span className="text-sm text-neutral-500">past 365 days · {inquiriesAll.length.toLocaleString()} inquiries</span>
      </div>

      {/* KPIs */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="text-xs text-neutral-400">Customer inquiries (365d)</div>
          <div className="text-2xl font-semibold">{real.length.toLocaleString()}</div>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="text-xs text-neutral-400">Top real category</div>
          <div className="text-2xl font-semibold">
            {(() => { const c = categories.find(([k]) => !NOISE.includes(k)); return c ? CATEGORY_LABELS[c[0]] ?? c[0] : "—"; })()}
          </div>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="text-xs text-neutral-400">Noise filtered out</div>
          <div className="text-2xl font-semibold">{Math.round((noiseCount / Math.max(1, inquiriesAll.length)) * 100)}%</div>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="text-xs text-neutral-400">Median time since purchase</div>
          <div className="text-2xl font-semibold">{medianDsp != null ? `${medianDsp}d` : "—"}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Category distribution — rows click through to sentiment breakdown */}
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="mb-1 text-sm font-medium">Request types</div>
          <div className="mb-3 text-xs text-neutral-400">Click a category to break it down by outcome.</div>
          <div className="space-y-2">
            {categories.map(([cat, n]) => (
              <Link key={cat} href={explore("category", "sentiment", `&xv=${cat}`)} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-neutral-50">
                <div className="w-40 truncate text-xs text-neutral-500">{CATEGORY_LABELS[cat] ?? cat}</div>
                <div className="h-4 flex-1 rounded bg-neutral-100">
                  <div className={`h-4 rounded ${NOISE.includes(cat) ? "bg-neutral-300" : "bg-blue-500"}`} style={{ width: `${(n / maxCat) * 100}%` }} />
                </div>
                <div className="w-12 text-right text-xs text-neutral-600">{n.toLocaleString()}</div>
              </Link>
            ))}
          </div>
        </div>

        {/* Sentiment — customer conversations only */}
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="mb-1 text-sm font-medium">How exchanges ended</div>
          <div className="mb-3 text-xs text-neutral-400">
            Customer conversations only — automated mail and vendor pitches excluded ({noiseCount.toLocaleString()} filtered).
          </div>
          <div className="mb-3 flex h-5 w-full overflow-hidden rounded-full bg-neutral-100">
            {(["positive", "neutral", "unresolved", "negative"] as const).map((s) => {
              const n = bySentiment.get(s) ?? 0;
              return n > 0 ? <div key={s} className={SENTIMENT_STYLE[s]} style={{ width: `${(n / sentimentTotal) * 100}%` }} /> : null;
            })}
          </div>
          <div className="flex flex-wrap gap-4">
            {(["positive", "neutral", "unresolved", "negative"] as const).map((s) => {
              const n = bySentiment.get(s) ?? 0;
              return (
                <Link key={s} href={explore("sentiment", "category", `&xv=${s}`)} className="flex items-center gap-1.5 text-xs text-neutral-600 hover:underline">
                  <span className={`inline-block h-2.5 w-2.5 rounded-full ${SENTIMENT_STYLE[s]}`} />
                  {s} · {n.toLocaleString()} ({Math.round((n / sentimentTotal) * 100)}%)
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {/* Inquiries vs sales */}
      <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
        <div className="mb-1 text-sm font-medium">Inquiries vs sales, by month</div>
        <div className="mb-3 text-xs text-neutral-400">Sales sources: Shopify (live, full history) + Amazon (live, 2026).</div>
        <div className="flex items-end gap-1" style={{ height: 180 }}>
          {months.map((m) => {
            const inq = byMonth.get(m) ?? 0;
            const rev = salesByMonth.get(m)?.revenue ?? 0;
            return (
              <div key={m} className="flex flex-1 flex-col items-center justify-end gap-0.5" title={`${monthLabel(m)}: ${inq} inquiries · $${Math.round(rev).toLocaleString()} sales`}>
                <div className="flex w-full items-end justify-center gap-0.5" style={{ height: 150 }}>
                  <div className="w-2/5 rounded-t bg-blue-500" style={{ height: `${(inq / maxInq) * 100}%`, minHeight: inq ? 3 : 0 }} />
                  <div className="w-2/5 rounded-t bg-emerald-400" style={{ height: `${(rev / maxRev) * 100}%`, minHeight: rev ? 3 : 0 }} />
                </div>
                <div className="text-[10px] text-neutral-400">{monthLabel(m)}</div>
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex gap-4 text-xs text-neutral-500">
          <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded bg-blue-500" /> inquiries</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded bg-emerald-400" /> sales revenue</span>
        </div>
      </div>

      {/* Time since purchase — buckets click through to category breakdown */}
      <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
        <div className="mb-1 text-sm font-medium">Time from purchase to inquiry</div>
        <div className="mb-3 text-xs text-neutral-400">
          {dsp.length.toLocaleString()} of {real.length.toLocaleString()} customer inquiries matched a prior order. Click a bucket to break it down.
        </div>
        <div className="space-y-2">
          {histo.map((b) => (
            <Link key={b.label} href={explore("bucket", "category", `&xv=${encodeURIComponent(b.label)}`)} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-neutral-50">
              <div className="w-20 text-xs text-neutral-500">{b.label}</div>
              <div className="h-4 flex-1 rounded bg-neutral-100">
                <div className="h-4 rounded bg-purple-500" style={{ width: `${(b.n / maxBucket) * 100}%` }} />
              </div>
              <div className="w-12 text-right text-xs text-neutral-600">{b.n.toLocaleString()}</div>
            </Link>
          ))}
        </div>
      </div>

      {/* Explore: cross-tab */}
      <div id="explore" className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
        <div className="mb-1 flex items-baseline justify-between">
          <div className="text-sm font-medium">Explore — {X.label} × {Y.label}</div>
          <div className="flex gap-2 text-xs">
            {[
              ["bucket", "category"],
              ["bucket", "sentiment"],
              ["category", "sentiment"],
            ].map(([x, y]) => (
              <Link key={`${x}${y}`} href={explore(x, y)} className={`rounded-full px-3 py-1 ${xDim === x && yDim === y ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-neutral-100"}`}>
                {DIMS[x].label.split(" ")[0]} × {DIMS[y].label.split(" ")[0]}
              </Link>
            ))}
          </div>
        </div>
        <div className="mb-3 text-xs text-neutral-400">
          Customer conversations only{xDim === "bucket" || yDim === "bucket" ? "; rows limited to purchase-matched inquiries" : ""}. Click any cell to list the underlying inquiries.
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="py-1.5 pr-2 text-left font-medium text-neutral-500">{X.label}</th>
                {yVals.map((yv) => (
                  <th key={yv} className="px-2 py-1.5 text-right font-medium text-neutral-500">{label(yDim, yv)}</th>
                ))}
                <th className="px-2 py-1.5 text-right font-medium text-neutral-400">total</th>
              </tr>
            </thead>
            <tbody>
              {xVals.map((xv) => {
                const t = rowTotal(xv) || 1;
                return (
                  <tr key={xv} className="border-t border-neutral-100">
                    <td className="py-1.5 pr-2 text-neutral-700">{label(xDim, xv)}</td>
                    {yVals.map((yv) => {
                      const n = cell(xv, yv);
                      const pct = Math.round((n / t) * 100);
                      return (
                        <td key={yv} className="px-2 py-1.5 text-right">
                          {n > 0 ? (
                            <Link href={`/analytics?x=${xDim}&y=${yDim}&xv=${encodeURIComponent(xv)}&yv=${encodeURIComponent(yv)}#drill`} className="rounded px-1 py-0.5 hover:bg-blue-50 hover:text-blue-700">
                              <span className="font-medium text-neutral-800">{n}</span>
                              <span className="text-neutral-400"> · {pct}%</span>
                            </Link>
                          ) : (
                            <span className="text-neutral-300">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-2 py-1.5 text-right text-neutral-400">{rowTotal(xv)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drill list */}
      {drill && (
        <div id="drill" className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <div className="text-sm font-medium">
              {sp.xv ? label(xDim, sp.xv) : ""}{sp.xv && sp.yv ? " × " : ""}{sp.yv ? label(yDim, sp.yv) : ""} — {drill.length} inquiries{drill.length === 50 ? " (first 50)" : ""}
            </div>
            <Link href={explore(xDim, yDim)} className="text-xs text-neutral-400 hover:text-neutral-900">clear ×</Link>
          </div>
          <div className="divide-y divide-neutral-100">
            {drill.map((q) => (
              <div key={q.id} className="flex items-center gap-3 py-1.5 text-xs">
                <span className="w-20 shrink-0 text-neutral-400">{fmtDate(q.threadCreatedAt)}</span>
                <span className="min-w-0 flex-1 truncate text-neutral-700">{q.fromEmail ?? "(no email)"}</span>
                <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-500">{CATEGORY_LABELS[q.category] ?? q.category}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-white ${SENTIMENT_STYLE[q.endSentiment]}`}>{q.endSentiment}</span>
                <span className="w-24 shrink-0 text-right text-neutral-400">{q.daysSincePurchase != null ? `${q.daysSincePurchase}d after buy` : "no order match"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
