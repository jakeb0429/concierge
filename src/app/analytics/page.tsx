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

const SENTIMENT_STYLE: Record<string, string> = {
  positive: "bg-green-500",
  neutral: "bg-neutral-300",
  unresolved: "bg-amber-400",
  negative: "bg-red-400",
};

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1]} ${y.slice(2)}`;
}

export default async function Analytics() {
  const tenant = await getCurrentTenant();
  const since = new Date(Date.now() - 365 * 24 * 3600 * 1000);

  const [inquiries, sales] = await Promise.all([
    prisma.analyticsInquiry.findMany({
      where: { tenantId: tenant.id, threadCreatedAt: { gte: since } },
      select: { category: true, endSentiment: true, threadCreatedAt: true, daysSincePurchase: true },
    }),
    prisma.salesMonthly.findMany({ orderBy: { month: "asc" } }),
  ]);

  // Aggregations
  const byCategory = new Map<string, number>();
  const bySentiment = new Map<string, number>();
  const byMonth = new Map<string, number>();
  const dsp: number[] = [];
  for (const q of inquiries) {
    byCategory.set(q.category, (byCategory.get(q.category) ?? 0) + 1);
    bySentiment.set(q.endSentiment, (bySentiment.get(q.endSentiment) ?? 0) + 1);
    byMonth.set(monthKey(q.threadCreatedAt), (byMonth.get(monthKey(q.threadCreatedAt)) ?? 0) + 1);
    if (q.daysSincePurchase != null) dsp.push(q.daysSincePurchase);
  }
  const categories = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
  const maxCat = categories[0]?.[1] ?? 1;

  // 12-month axis ending this month
  const months: string[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    months.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  }
  const salesByMonth = new Map<string, { orders: number; revenue: number }>();
  for (const s of sales) {
    salesByMonth.set(monthKey(s.month), { orders: s.orders, revenue: Number(s.revenue) });
  }
  const maxInq = Math.max(1, ...months.map((m) => byMonth.get(m) ?? 0));
  const maxRev = Math.max(1, ...months.map((m) => salesByMonth.get(m)?.revenue ?? 0));

  // Days-since-purchase histogram
  const buckets = [
    { label: "≤ 30d", min: 0, max: 30 },
    { label: "31–90d", min: 31, max: 90 },
    { label: "91–180d", min: 91, max: 180 },
    { label: "181–365d", min: 181, max: 365 },
    { label: "1–2y", min: 366, max: 730 },
    { label: "2y+", min: 731, max: Infinity },
  ].map((b) => ({ ...b, n: dsp.filter((d) => d >= b.min && d <= b.max).length }));
  const maxBucket = Math.max(1, ...buckets.map((b) => b.n));
  const medianDsp = dsp.length ? [...dsp].sort((a, b) => a - b)[Math.floor(dsp.length / 2)] : null;

  const noise = (byCategory.get("vendor_pitch") ?? 0) + (byCategory.get("automated_notification") ?? 0);
  const sentimentTotal = [...bySentiment.values()].reduce((a, b) => a + b, 0) || 1;

  return (
    <div>
      <div className="mb-5 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Analytics</h1>
        <span className="text-sm text-neutral-500">past 365 days · {inquiries.length.toLocaleString()} inquiries</span>
      </div>

      {inquiries.length === 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          The 365-day backfill is still running — numbers fill in as it processes.
        </div>
      )}

      {/* KPIs */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="text-xs text-neutral-400">Inquiries (365d)</div>
          <div className="text-2xl font-semibold">{inquiries.length.toLocaleString()}</div>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="text-xs text-neutral-400">Top category</div>
          <div className="text-2xl font-semibold">{categories[0] ? CATEGORY_LABELS[categories[0][0]] ?? categories[0][0] : "—"}</div>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="text-xs text-neutral-400">Noise (pitches + automated)</div>
          <div className="text-2xl font-semibold">{inquiries.length ? Math.round((noise / inquiries.length) * 100) : 0}%</div>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="text-xs text-neutral-400">Median time since purchase</div>
          <div className="text-2xl font-semibold">{medianDsp != null ? `${medianDsp}d` : "—"}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Category distribution */}
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="mb-3 text-sm font-medium">Request types</div>
          <div className="space-y-2">
            {categories.map(([cat, n]) => (
              <div key={cat} className="flex items-center gap-2">
                <div className="w-40 truncate text-xs text-neutral-500">{CATEGORY_LABELS[cat] ?? cat}</div>
                <div className="h-4 flex-1 rounded bg-neutral-100">
                  <div className="h-4 rounded bg-blue-500" style={{ width: `${(n / maxCat) * 100}%` }} />
                </div>
                <div className="w-12 text-right text-xs text-neutral-600">{n.toLocaleString()}</div>
              </div>
            ))}
            {categories.length === 0 && <div className="text-sm text-neutral-400">No data yet.</div>}
          </div>
        </div>

        {/* Sentiment of the result */}
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="mb-3 text-sm font-medium">How exchanges ended (customer&apos;s last message)</div>
          <div className="mb-3 flex h-5 w-full overflow-hidden rounded-full bg-neutral-100">
            {(["positive", "neutral", "unresolved", "negative"] as const).map((s) => {
              const n = bySentiment.get(s) ?? 0;
              return n > 0 ? (
                <div key={s} className={SENTIMENT_STYLE[s]} style={{ width: `${(n / sentimentTotal) * 100}%` }} />
              ) : null;
            })}
          </div>
          <div className="flex flex-wrap gap-4">
            {(["positive", "neutral", "unresolved", "negative"] as const).map((s) => {
              const n = bySentiment.get(s) ?? 0;
              return (
                <div key={s} className="flex items-center gap-1.5 text-xs text-neutral-600">
                  <span className={`inline-block h-2.5 w-2.5 rounded-full ${SENTIMENT_STYLE[s]}`} />
                  {s} · {n.toLocaleString()} ({Math.round((n / sentimentTotal) * 100)}%)
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Inquiries vs sales over time */}
      <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
        <div className="mb-1 text-sm font-medium">Inquiries vs sales, by month</div>
        <div className="mb-3 text-xs text-neutral-400">
          Sales sources: Shopify warehouse (through Aug 2025) + Amazon (live, 2026). D2C Shopify since Sep 2025
          needs a fresh Shopify token — the gap is real data absence, not zero sales.
        </div>
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

      {/* Time since purchase */}
      <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
        <div className="mb-1 text-sm font-medium">Time from purchase to inquiry</div>
        <div className="mb-3 text-xs text-neutral-400">
          Matched by customer email against order history{dsp.length ? ` — ${dsp.length.toLocaleString()} of ${inquiries.length.toLocaleString()} inquiries matched a prior order` : " — matching runs after the backfill"}.
        </div>
        <div className="space-y-2">
          {buckets.map((b) => (
            <div key={b.label} className="flex items-center gap-2">
              <div className="w-20 text-xs text-neutral-500">{b.label}</div>
              <div className="h-4 flex-1 rounded bg-neutral-100">
                <div className="h-4 rounded bg-purple-500" style={{ width: `${(b.n / maxBucket) * 100}%` }} />
              </div>
              <div className="w-12 text-right text-xs text-neutral-600">{b.n.toLocaleString()}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
