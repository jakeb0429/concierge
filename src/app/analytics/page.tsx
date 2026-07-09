import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { sessionUser, isAdminRole } from "@/lib/roles";
import { computeResponseTimes, fmtDuration } from "@/lib/response-times";
import { categoryLabel } from "@/lib/categories";
import { msAgo } from "@/lib/time";
import { ticketAnalytics, myStats, salesByLine, sortCategoryRows, type CategorySort } from "@/lib/analytics";
import { StatTile, BarRow, TrendChart, FilterPills } from "@/app/components/analytics-ui";

export const dynamic = "force-dynamic";

/** Machine mail + people selling TO Rheos — excluded from customer-experience views. */
const NOISE = ["automated_notification", "vendor_pitch"];

const SENTIMENT_STYLE: Record<string, string> = {
  positive: "bg-green-500",
  neutral: "bg-neutral-300",
  unresolved: "bg-amber-400",
  negative: "bg-red-400",
};

const RETURN_STAGE_LABEL: Record<string, string> = {
  requested: "Requested",
  approved: "Approved",
  label_sent: "Label sent",
  package_received: "Package received",
  refunded: "Refunded",
  exchanged: "Exchanged",
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
  productFamily: string | null;
  frameColor: string | null;
  lensColor: string | null;
  productStyle: string | null;
  productGender: string | null;
};

function countBy(qs: Inq[], of: (q: Inq) => string | null): Map<string, number> {
  const m = new Map<string, number>();
  for (const q of qs) {
    const v = of(q);
    if (v) m.set(v, (m.get(v) ?? 0) + 1);
  }
  return m;
}
const topValues = (qs: Inq[], of: (q: Inq) => string | null, limit: number) =>
  [...countBy(qs, of).entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([v]) => v);

const DIMS: Record<string, { label: string; of: (q: Inq) => string | null; values: (qs: Inq[]) => string[] }> = {
  bucket: {
    label: "Time since purchase",
    of: (q) => bucketOf(q.daysSincePurchase),
    values: () => BUCKETS.map((b) => b.label),
  },
  category: {
    label: "Category",
    of: (q) => q.category,
    values: (qs) => topValues(qs, (q) => q.category, 99),
  },
  sentiment: {
    label: "Outcome sentiment",
    of: (q) => q.endSentiment,
    values: () => ["positive", "neutral", "unresolved", "negative"],
  },
  silhouette: {
    label: "Silhouette",
    of: (q) => q.productFamily,
    values: (qs) => topValues(qs, (q) => q.productFamily, 12),
  },
  style: {
    label: "Frame style",
    of: (q) => q.productStyle,
    values: () => ["wrap", "lifestyle"],
  },
  framecolor: {
    label: "Frame color",
    of: (q) => q.frameColor,
    values: (qs) => topValues(qs, (q) => q.frameColor, 10),
  },
  lenscolor: {
    label: "Lens color",
    of: (q) => q.lensColor,
    values: (qs) => topValues(qs, (q) => q.lensColor, 10),
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

type SP = { x?: string; y?: string; xv?: string; yv?: string; days?: string; cats?: string; rts?: string };

export default async function Analytics({ searchParams }: { searchParams: Promise<SP> }) {
  const tenant = await getCurrentTenant();
  const me = await sessionUser();
  const admin = isAdminRole(me?.role);
  const sp = await searchParams;

  const days = sp.days === "90" ? 90 : 30; // live-ticket window
  const weeks = Math.ceil(days / 7);
  const catSort: CategorySort = sp.cats === "negative" ? "negative" : "volume";
  const rtSort = sp.rts === "median" ? "median" : "volume";
  const xDim = DIMS[sp.x ?? ""] ? sp.x! : "bucket";
  const yDim = DIMS[sp.y ?? ""] && sp.y !== xDim ? sp.y! : xDim === "category" ? "sentiment" : "category";
  const since = msAgo(365 * 24 * 3600 * 1000);

  // Keep the current filter state when a pill changes one key. xv/yv (drill
  // selection) never persist implicitly — pass them explicitly when wanted.
  const qs = (over: Partial<SP>, hash = "") => {
    const merged: Record<string, string | undefined> = { x: sp.x, y: sp.y, days: sp.days, cats: sp.cats, rts: sp.rts, ...over };
    const pairs = Object.entries(merged).filter(([, v]) => v) as [string, string][];
    return `/analytics${pairs.length ? "?" + pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&") : ""}${hash}`;
  };

  const [inquiriesAll, sales, sentDrafts, live, mine, myUser, byLine] = await Promise.all([
    prisma.analyticsInquiry.findMany({
      where: { tenantId: tenant.id, threadCreatedAt: { gte: since } },
      select: { id: true, category: true, endSentiment: true, threadCreatedAt: true, daysSincePurchase: true, fromEmail: true, productFamily: true, frameColor: true, lensColor: true, productStyle: true, productGender: true },
      orderBy: { threadCreatedAt: "desc" },
    }),
    prisma.salesMonthly.findMany({ orderBy: { month: "asc" } }),
    Promise.all([
      prisma.draft.count({ where: { tenantId: tenant.id, status: "sent" } }),
      prisma.draft.count({ where: { tenantId: tenant.id, status: "sent", editedBody: null } }),
    ]).then(([total, unedited]) => ({ total, unedited })),
    ticketAnalytics(tenant.id, weeks),
    me ? myStats(tenant.id, me.id) : Promise.resolve(null),
    me ? prisma.user.findUnique({ where: { id: me.id }, select: { name: true } }) : Promise.resolve(null),
    admin ? salesByLine(tenant.id) : Promise.resolve(null),
  ]);
  const real = inquiriesAll.filter((q) => !NOISE.includes(q.category));

  // Mined-history aggregations (365d)
  const byMonth = new Map<string, number>();
  for (const q of inquiriesAll) byMonth.set(monthKey(q.threadCreatedAt), (byMonth.get(monthKey(q.threadCreatedAt)) ?? 0) + 1);
  const catRows = (() => {
    const m = new Map<string, { category: string; n: number; negative: number }>();
    for (const q of inquiriesAll) {
      const cur = m.get(q.category) ?? { category: q.category, n: 0, negative: 0 };
      cur.n++;
      if (q.endSentiment === "negative") cur.negative++;
      m.set(q.category, cur);
    }
    return sortCategoryRows([...m.values()], catSort);
  })();
  const maxCat = Math.max(1, ...catRows.map((r) => r.n));

  const bySentiment = new Map<string, number>();
  const dsp: number[] = [];
  for (const q of real) {
    bySentiment.set(q.endSentiment, (bySentiment.get(q.endSentiment) ?? 0) + 1);
    if (q.daysSincePurchase != null) dsp.push(q.daysSincePurchase);
  }
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
  const xCounts = countBy(real, X.of);
  const yCounts = countBy(real, Y.of);
  const xVals = X.values(real).filter((v) => (xCounts.get(v) ?? 0) > 0);
  const yVals = Y.values(real).filter((v) => (yCounts.get(v) ?? 0) > 0);
  const cellCounts = countBy(real, (q) => {
    const xv = X.of(q);
    const yv = Y.of(q);
    return xv && yv ? `${xv}␟${yv}` : null;
  });
  const cell = (xv: string, yv: string) => cellCounts.get(`${xv}␟${yv}`) ?? 0;
  const rowTotal = (xv: string) => xCounts.get(xv) ?? 0;
  const label = (dim: string, v: string) => (dim === "category" || dim === "sentiment" ? (dim === "category" ? categoryLabel(v) : v) : v);

  const drill =
    sp.xv || sp.yv
      ? real.filter((q) => (!sp.xv || X.of(q) === sp.xv) && (!sp.yv || Y.of(q) === sp.yv)).slice(0, 50)
      : null;

  // Response times — live tickets, noise excluded, window follows the pills.
  const rt = await computeResponseTimes(tenant.id, days);
  const byAssignee = [...rt.byAssignee].sort((a, b) =>
    rtSort === "median"
      ? (a.stats.medianMs ?? Infinity) - (b.stats.medianMs ?? Infinity)
      : b.stats.n - a.stats.n
  );
  const myRt = myUser?.name ? rt.byAssignee.find((a) => a.label === myUser.name) : null;
  const returnsTotal = live.returnsPipeline.reduce((s, r) => s + r.n, 0);
  const maxOpenCat = Math.max(1, ...live.openByCategory.map((r) => r.n));
  const maxMailbox = Math.max(1, ...live.mailboxMix.map((r) => r.n));

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="page-title">Analytics</h1>
        <div className="flex items-center gap-3">
          <FilterPills
            options={[
              { value: "30", label: "30 days" },
              { value: "90", label: "90 days" },
            ]}
            current={String(days)}
            hrefFor={(v) => qs({ days: v === "30" ? undefined : v })}
          />
          <span className="text-sm text-neutral-500">live sections · history spans 365d</span>
        </div>
      </div>

      {/* MY WORK — every rep gets their own numbers first */}
      {me && mine && (
        <div className="mb-4">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-gold" />
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-warm-grey">My work</span>
            <span className="text-[10px] text-neutral-400">· {myUser?.name ?? me.email}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <StatTile label="My open tickets" value={mine.openAssigned} href="/?view=mine" tone={mine.openAssigned ? "amber" : undefined} />
            <StatTile label="Waiting on my review" value={mine.inReview} href="/?view=mine" />
            <StatTile label="My replies (30d)" value={mine.repliesSent30d} sub="sends you confirmed" />
            <StatTile label="My returns in flight" value={mine.returnsInFlight} tone={mine.returnsInFlight ? "violet" : undefined} href="/?view=mine" />
            <StatTile label="My median first reply" value={myRt ? fmtDuration(myRt.stats.medianMs) : "—"} sub={myRt ? `${myRt.stats.n} replies in ${days}d` : `no replies in ${days}d yet`} />
          </div>
        </div>
      )}

      {/* TICKET FLOW — live volume in vs answered (admin) */}
      {admin && (
        <div className="mb-4 rounded-xl border border-neutral-200 bg-white p-4">
          <div className="mb-1 flex items-baseline justify-between">
            <div className="text-sm font-medium">Ticket flow — new vs answered, weekly</div>
            <span className="text-xs text-neutral-400">past {days} days</span>
          </div>
          <TrendChart a={live.newByWeek} b={live.repliesByWeek} aLabel="New tickets" bLabel="Replies sent" />
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-400">Open now, by category</div>
              {live.openByCategory.length ? (
                <div className="space-y-1.5">
                  {live.openByCategory.map((r) => (
                    <BarRow
                      key={r.category}
                      label={categoryLabel(r.category)}
                      n={r.n}
                      max={maxOpenCat}
                      href={`/?cat=${r.category}`}
                      right={r.negative ? `${r.n} · ${r.negative} urgent` : String(r.n)}
                      title={`${r.n} open${r.negative ? `, ${r.negative} urgent` : ""} — open in inbox`}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-neutral-400">Inbox is clear.</p>
              )}
            </div>
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-400">Arriving mailbox ({days}d)</div>
              <div className="space-y-1.5">
                {live.mailboxMix.map((r) => (
                  <BarRow
                    key={r.label}
                    label={r.label}
                    n={r.n}
                    max={maxMailbox}
                    color={r.line === "b2b" ? "bg-violet-400" : "bg-scribe-navy"}
                    right={`${r.n} · ${r.line}`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* D2C vs B2B — the two business lines side by side (admin) */}
      {admin && byLine && (
        <div className="mb-4 rounded-xl border border-neutral-200 bg-white p-4">
          <div className="mb-1 flex items-baseline justify-between">
            <div className="text-sm font-medium">D2C vs B2B</div>
            <span className="text-xs text-neutral-400">revenue trailing 12 months · tickets past {days} days</span>
          </div>
          <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-5">
            <StatTile
              label="D2C revenue (12mo)"
              value={`$${Math.round(byLine.d2cTotal).toLocaleString()}`}
              sub={`${byLine.d2cOrders.toLocaleString()} orders`}
            />
            <StatTile
              label="B2B revenue (12mo)"
              value={`$${Math.round(byLine.b2bTotal).toLocaleString()}`}
              sub={`${byLine.b2bOrders.toLocaleString()} deals`}
            />
            <StatTile
              label="B2B share of revenue"
              value={`${byLine.d2cTotal + byLine.b2bTotal ? Math.round((byLine.b2bTotal / (byLine.d2cTotal + byLine.b2bTotal)) * 100) : 0}%`}
            />
            {live.lineMix.map((l) => (
              <StatTile
                key={l.line}
                label={`${l.line.toUpperCase()} tickets (${days}d)`}
                value={l.n}
                sub={`${l.open} open now`}
                tone={l.line === "b2b" ? "violet" : undefined}
              />
            ))}
          </div>
          <TrendChart
            a={byLine.d2c}
            b={byLine.b2b}
            aLabel="D2C revenue"
            bLabel="B2B revenue"
            fmt={(v) => `$${Math.round(v).toLocaleString()}`}
          />
        </div>
      )}

      {/* RETURNS PIPELINE (admin) — the guided-returns lifecycle */}
      {admin && (
        <div className="mb-4 rounded-xl border border-l-4 border-neutral-200 border-l-violet-400 bg-white p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <div className="text-sm font-medium">Returns &amp; exchanges in flight</div>
            <Link href="/?cat=returns_exchange" className="text-xs text-blue-600 hover:underline">
              open returns tickets →
            </Link>
          </div>
          {returnsTotal ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
              <StatTile label="Total in flight" value={returnsTotal} tone="violet" />
              {live.returnsPipeline.map((r) => (
                <StatTile key={r.status} label={RETURN_STAGE_LABEL[r.status] ?? r.status} value={r.n} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-neutral-400">
              No returns in flight. Tickets enter this pipeline when a rep clicks &quot;Start return/exchange&quot; on a returns ticket.
            </p>
          )}
        </div>
      )}

      {/* Response times — how fast the team actually answers */}
      <div className="mb-4 rounded-xl border border-neutral-200 bg-white p-4">
        <div className="mb-1 flex items-baseline justify-between">
          <div className="text-sm font-medium">Response times</div>
          <span className="text-xs text-neutral-400">past {rt.sinceDays} days · noise excluded</span>
        </div>
        <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div>
            <div className="text-xs text-neutral-400">Median first reply</div>
            <div className="text-2xl font-semibold">{fmtDuration(rt.overall.medianMs)}</div>
            <div className="text-[11px] text-neutral-400">{rt.overall.n} replied</div>
          </div>
          <div>
            <div className="text-xs text-neutral-400">P90 first reply</div>
            <div className="text-2xl font-semibold">{fmtDuration(rt.overall.p90Ms)}</div>
          </div>
          <div>
            <div className="text-xs text-neutral-400">Median resolution</div>
            <div className="text-2xl font-semibold">{fmtDuration(rt.overall.medianResolutionMs)}</div>
            <div className="text-[11px] text-neutral-400">{rt.overall.resolvedN} resolved</div>
          </div>
          <div>
            <div className="text-xs text-neutral-400">Awaiting first reply</div>
            <div className={`text-2xl font-semibold ${rt.awaitingFirstReply.length ? "text-amber-700" : ""}`}>
              {rt.awaitingFirstReply.length}
            </div>
            {rt.awaitingFirstReply[0] && (
              <div className="text-[11px] text-amber-700">oldest waiting {fmtDuration(rt.awaitingFirstReply[0].waitingMs)}</div>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {admin && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">By person</span>
                <FilterPills
                  options={[
                    { value: "volume", label: "by volume" },
                    { value: "median", label: "by speed" },
                  ]}
                  current={rtSort}
                  hrefFor={(v) => qs({ rts: v === "volume" ? undefined : v })}
                />
              </div>
              {byAssignee.length ? (
                <div className="space-y-1 text-xs">
                  {byAssignee.map((a) => (
                    <div key={a.label} className="flex items-baseline justify-between">
                      <span className="text-neutral-700">{a.label}</span>
                      <span className="text-neutral-500">
                        median {fmtDuration(a.stats.medianMs)} · {a.stats.n} repl{a.stats.n === 1 ? "y" : "ies"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-neutral-400">No replies in the window yet.</p>
              )}
            </div>
          )}
          <div>
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-400">By category</div>
            <div className="space-y-1 text-xs">
              {rt.byCategory.map((c) => (
                <div key={c.category} className="flex items-baseline justify-between">
                  <span className="text-neutral-700">{categoryLabel(c.category)}</span>
                  <span className="text-neutral-500">
                    median {fmtDuration(c.stats.medianMs)} · {c.stats.n}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 365-day mined history */}
      <div className="mb-1.5 flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-scribe-blue" />
        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-warm-grey">Customer-experience history</span>
        <span className="text-[10px] text-neutral-400">
          · past 365 days · {inquiriesAll.length.toLocaleString()} inquiries · mined from the hello@ (D2C) mailbox — wholesale history not yet backfilled
        </span>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Customer inquiries (365d)" value={real.length.toLocaleString()} />
        <StatTile
          label="Top category"
          value={(() => { const c = catRows.find((r) => !NOISE.includes(r.category)); return c ? categoryLabel(c.category) : "—"; })()}
        />
        {admin ? (
          <StatTile
            label="Drafts sent unedited"
            value={sentDrafts.total ? `${Math.round((sentDrafts.unedited / sentDrafts.total) * 100)}%` : "—"}
            sub={`${sentDrafts.total} sent · noise filtered ${Math.round((noiseCount / Math.max(1, inquiriesAll.length)) * 100)}%`}
          />
        ) : (
          <StatTile label="Noise filtered" value={`${Math.round((noiseCount / Math.max(1, inquiriesAll.length)) * 100)}%`} sub="automated + vendor mail" />
        )}
        <StatTile label="Median time since purchase" value={medianDsp != null ? `${medianDsp}d` : "—"} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Category distribution with sort */}
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="mb-1 flex items-center justify-between">
            <div className="text-sm font-medium">Request types</div>
            <FilterPills
              options={[
                { value: "volume", label: "by volume" },
                { value: "negative", label: "by negative rate" },
              ]}
              current={catSort}
              hrefFor={(v) => qs({ cats: v === "volume" ? undefined : v })}
            />
          </div>
          <div className="mb-3 text-xs text-neutral-400">Click a category to break it down by outcome.</div>
          <div className="space-y-2">
            {catRows.map((r) => (
              <BarRow
                key={r.category}
                label={categoryLabel(r.category)}
                n={r.n}
                max={maxCat}
                href={qs({ x: "category", y: "sentiment", xv: r.category }, "#explore")}
                color={NOISE.includes(r.category) ? "bg-neutral-300" : "bg-scribe-blue"}
                right={catSort === "negative" ? `${r.n} · ${r.n ? Math.round((r.negative / r.n) * 100) : 0}% neg` : r.n.toLocaleString()}
                title={`${r.n} inquiries, ${r.negative} ended negative`}
              />
            ))}
          </div>
        </div>

        {/* Sentiment — customer conversations only */}
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="mb-1 text-sm font-medium">How exchanges ended</div>
          <div className="mb-3 text-xs text-neutral-400">
            Customer conversations only — automated mail and vendor pitches excluded ({noiseCount.toLocaleString()} filtered).
            Judged from the end of the full thread, rep replies included — unresolved means the customer&apos;s
            last message got no reply.
          </div>
          <div className="mb-3 flex h-5 w-full gap-0.5 overflow-hidden rounded-full bg-neutral-100">
            {(["positive", "neutral", "unresolved", "negative"] as const).map((s) => {
              const n = bySentiment.get(s) ?? 0;
              return n > 0 ? <div key={s} className={SENTIMENT_STYLE[s]} style={{ width: `${(n / sentimentTotal) * 100}%` }} /> : null;
            })}
          </div>
          <div className="flex flex-wrap gap-4">
            {(["positive", "neutral", "unresolved", "negative"] as const).map((s) => {
              const n = bySentiment.get(s) ?? 0;
              return (
                <Link key={s} href={qs({ x: "sentiment", y: "category", xv: s }, "#explore")} className="flex items-center gap-1.5 text-xs text-neutral-600 hover:underline">
                  <span className={`inline-block h-2.5 w-2.5 rounded-full ${SENTIMENT_STYLE[s]}`} />
                  {s} · {n.toLocaleString()} ({Math.round((n / sentimentTotal) * 100)}%)
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {/* Inquiries vs sales — two aligned rows, one month axis, separate scales stated */}
      {admin && (
        <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
          <div className="mb-1 text-sm font-medium">Inquiries vs sales, by month</div>
          <div className="mb-3 text-xs text-neutral-400">
            Sales sources: Shopify (live, full history) + Amazon (live, 2026). Each row has its own scale — read shape, not height across rows.
          </div>
          <div className="space-y-2">
            <div>
              <div className="mb-0.5 text-[10px] uppercase tracking-wide text-neutral-400">Inquiries (max {maxInq.toLocaleString()})</div>
              <div className="flex items-end gap-1" style={{ height: 64 }}>
                {months.map((m) => {
                  const inq = byMonth.get(m) ?? 0;
                  return (
                    <div key={m} className="flex-1" title={`${monthLabel(m)}: ${inq} inquiries`}>
                      <div className="mx-auto w-full rounded-t bg-scribe-blue" style={{ height: `${(inq / maxInq) * 60}px`, minHeight: inq ? 3 : 0 }} />
                    </div>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="mb-0.5 text-[10px] uppercase tracking-wide text-neutral-400">Sales revenue (max ${Math.round(maxRev).toLocaleString()})</div>
              <div className="flex items-end gap-1" style={{ height: 64 }}>
                {months.map((m) => {
                  const rev = salesByMonth.get(m)?.revenue ?? 0;
                  return (
                    <div key={m} className="flex-1" title={`${monthLabel(m)}: $${Math.round(rev).toLocaleString()} sales`}>
                      <div className="mx-auto w-full rounded-t bg-gold" style={{ height: `${(rev / maxRev) * 60}px`, minHeight: rev ? 3 : 0 }} />
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-1">
                {months.map((m) => (
                  <div key={m} className="flex-1 text-center text-[10px] text-neutral-400">{monthLabel(m)}</div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Time since purchase — buckets click through to category breakdown */}
      <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
        <div className="mb-1 text-sm font-medium">Time from purchase to inquiry</div>
        <div className="mb-3 text-xs text-neutral-400">
          {dsp.length.toLocaleString()} of {real.length.toLocaleString()} customer inquiries matched a prior order. Click a bucket to break it down.
        </div>
        <div className="space-y-2">
          {histo.map((b) => (
            <BarRow
              key={b.label}
              label={b.label}
              n={b.n}
              max={maxBucket}
              href={qs({ x: "bucket", y: "category", xv: b.label }, "#explore")}
              color="bg-violet-400"
            />
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
              ["silhouette", "category"],
              ["silhouette", "sentiment"],
              ["style", "category"],
              ["framecolor", "category"],
            ].map(([x, y]) => (
              <Link key={`${x}${y}`} href={qs({ x, y }, "#explore")} className={`rounded-full px-3 py-1 ${xDim === x && yDim === y ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-neutral-100"}`}>
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
              <tr className="bg-cream">
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
                            <Link href={qs({ x: xDim, y: yDim, xv, yv }, "#drill")} className="rounded px-1 py-0.5 hover:bg-blue-50 hover:text-blue-700">
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
            <Link href={qs({ x: xDim, y: yDim }, "#explore")} className="text-xs text-neutral-400 hover:text-neutral-900">clear ×</Link>
          </div>
          <div className="divide-y divide-neutral-100">
            {drill.map((q) => (
              <div key={q.id} className="flex items-center gap-3 py-1.5 text-xs">
                <span className="w-20 shrink-0 text-neutral-400">{fmtDate(q.threadCreatedAt)}</span>
                <span className="min-w-0 flex-1 truncate text-neutral-700">{q.fromEmail ?? "(no email)"}</span>
                <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-500">{categoryLabel(q.category)}</span>
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
