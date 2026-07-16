import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentTenant } from "@/lib/tenant";
import { sessionUser, isAdminRole } from "@/lib/roles";
import { buildDigest, digestRecords, DRILL_TITLE, DRILL_KEYS, type DigestPeriod, type DrillKey } from "@/lib/digest";
import { fmtDuration } from "@/lib/response-times";

export const dynamic = "force-dynamic";

/** The daily/weekly operational digest — same numbers the emailed report carries. */
export default async function DigestPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; show?: string }>;
}) {
  const me = await sessionUser();
  if (!me || !isAdminRole(me.role)) redirect("/");
  const tenant = await getCurrentTenant();
  const { period: raw, show: rawShow } = await searchParams;
  const period: DigestPeriod = raw === "weekly" ? "weekly" : "daily";
  const show: DrillKey | null = (DRILL_KEYS as readonly string[]).includes(rawShow ?? "") ? (rawShow as DrillKey) : null;
  const [d, records] = await Promise.all([
    buildDigest(tenant.id, period),
    show ? digestRecords(tenant.id, period, show) : Promise.resolve(null),
  ]);
  const qs = period === "weekly" ? "?period=weekly" : "?";
  const drillHref = (key: DrillKey) =>
    show === key ? `/digest${period === "weekly" ? "?period=weekly" : ""}` : `/digest${qs}${qs.endsWith("?") ? "" : "&"}show=${key}#records`;

  // Every number is clickable. Ticket-shaped tiles jump to the INBOX with the
  // matching saved filter set (same filters the toolbar there offers); tiles
  // for non-ticket records (events, training, notes) drill down inline here.
  const window = period === "daily" ? "24h" : "7d";
  const tile = (
    label: string,
    value: string | number,
    target: { drill: DrillKey } | { inbox: string },
    tone?: "amber" | "red"
  ) => {
    const isDrill = "drill" in target;
    const href = isDrill ? drillHref(target.drill) : `/?${target.inbox}`;
    const open = isDrill && show === target.drill;
    return (
      <Link
        href={href}
        className={`block rounded-xl border bg-white p-4 transition-colors hover:border-gold ${open ? "border-gold" : "border-neutral-200"}`}
      >
        <div className="text-xs text-neutral-400">{label}</div>
        <div className={`text-2xl font-semibold ${tone === "amber" ? "text-amber-700" : tone === "red" ? "text-red-700" : ""}`}>
          {value}
        </div>
        <div className="text-[10px] text-neutral-300">
          {isDrill ? (open ? "hide records" : "view records") : "open in inbox →"}
        </div>
      </Link>
    );
  };

  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between">
        <div className="flex items-baseline gap-4">
          <h1 className="page-title">Digest — {d.tenantName}</h1>
          <nav className="flex gap-2 text-sm">
            {(["daily", "weekly"] as const).map((k) => (
              <Link
                key={k}
                href={k === "daily" ? "/digest" : "/digest?period=weekly"}
                className={`rounded-full px-3 py-1 ${period === k ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-neutral-100"}`}
              >
                {k === "daily" ? "Daily" : "Weekly"}
              </Link>
            ))}
          </nav>
        </div>
        <span className="text-sm text-neutral-500">{d.periodLabel}</span>
      </div>

      {/* what happened */}
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-400">
        Activity · {d.periodLabel}
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {tile("New inquiries", d.newTickets, { inbox: `view=all&since=${window}&sort=newest` })}
        {tile("Replies sent", d.repliesSent, { drill: "replies" })}
        {tile("Noise filtered", d.noiseFiltered, { inbox: `view=noise&since=${window}&sort=newest` })}
        {tile("Brain changes", d.brainChanges, { drill: "brain" })}
      </div>
      {d.newByCategory.length > 0 && (
        <div className="mb-4 rounded-xl border border-neutral-200 bg-white p-4 text-xs">
          <div className="mb-3 text-sm font-medium">
            New inquiries by type{" "}
            <span className="text-xs font-normal text-neutral-400">· {d.periodLabel} · click a bar to open that view</span>
          </div>
          <div className="space-y-1.5">
            {(() => {
              const max = Math.max(...d.newByCategory.map((c) => c.n));
              return d.newByCategory.map((c) => (
                <Link
                  key={c.category}
                  href={`/?view=all&since=${window}&cat=${encodeURIComponent(c.category)}&sort=newest`}
                  className="group flex items-center gap-2"
                >
                  <span className="w-36 flex-shrink-0 truncate text-neutral-500 group-hover:text-neutral-800">{c.label}</span>
                  <span className="h-4 flex-1 rounded bg-neutral-100">
                    <span
                      className="block h-4 rounded bg-[var(--color-gold)] opacity-80 transition-opacity group-hover:opacity-100"
                      style={{ width: `${Math.max((c.n / max) * 100, 3)}%` }}
                    />
                  </span>
                  <span className="w-8 flex-shrink-0 text-right font-semibold tabular-nums">{c.n}</span>
                </Link>
              ));
            })()}
          </div>
        </div>
      )}

      {/* where things stand right now */}
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-400">Right now</div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {tile("Need a reply", d.needsReply, { inbox: "needs=1&sort=waiting" }, d.needsReply > 0 ? "amber" : undefined)}
        {tile("Urgent open", d.urgentOpen, { inbox: "priority=urgent&sort=oldest" }, d.urgentOpen > 0 ? "red" : undefined)}
        {tile("Unassigned", d.unassigned, { inbox: "assignee=none&sort=oldest" }, d.unassigned > 0 ? "amber" : undefined)}
        {tile("Training pending", d.trainingOpen, { drill: "training" })}
        {tile("Expired notes", d.expiredNotes, { drill: "expired" }, d.expiredNotes > 0 ? "amber" : undefined)}
      </div>

      {/* the urgent queue itself — one clickable tile per ticket */}
      {d.urgentTickets.length > 0 && (
        <>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-red-700">
            Urgent — needs eyes ({d.urgentTickets.length})
          </div>
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {d.urgentTickets.map((t) => (
              <Link
                key={t.id}
                href={`/tickets/${t.id}`}
                className="block rounded-xl border border-red-200 border-l-4 border-l-red-600 bg-white p-3 transition-colors hover:border-red-400"
              >
                <div className="mb-0.5 flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-neutral-900">{t.subject ?? "(no subject)"}</span>
                  <span className="flex-shrink-0 text-xs font-semibold text-red-700">{fmtDuration(t.waitingMs)}</span>
                </div>
                <div className="mb-1 truncate text-xs text-neutral-500">
                  {t.customer}
                  {t.category ? ` · ${t.category.replace(/_/g, " ")}` : ""}
                </div>
                {t.preview && <p className="line-clamp-2 text-xs leading-snug text-neutral-600">{t.preview}</p>}
              </Link>
            ))}
          </div>
        </>
      )}

      {show && records && (
        <div id="records" className="mb-4 rounded-xl border border-gold/40 bg-white p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <div className="text-sm font-medium">{DRILL_TITLE[show]}</div>
            <span className="text-xs text-neutral-400">
              {records.length} record{records.length === 1 ? "" : "s"}
              {["new", "replies", "noise", "brain"].includes(show) ? ` · ${d.periodLabel}` : " · right now"}
            </span>
          </div>
          {records.length ? (
            <div className="divide-y divide-neutral-100">
              {records.map((r, i) => (
                <div key={i} className="flex items-baseline gap-3 py-1.5 text-xs">
                  <span className="w-28 flex-shrink-0 text-neutral-400">
                    {r.when
                      ? new Date(r.when).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
                      : ""}
                  </span>
                  {r.href ? (
                    <Link href={r.href} className="min-w-0 flex-1 truncate font-medium text-neutral-800 hover:underline">
                      {r.label}
                    </Link>
                  ) : (
                    <span className="min-w-0 flex-1 truncate font-medium text-neutral-800">{r.label}</span>
                  )}
                  <span className="flex-shrink-0 text-neutral-400">{r.sublabel}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-neutral-400">Nothing in this bucket right now.</p>
          )}
        </div>
      )}

      {/* trailing median first-reply, one bar per day */}
      {d.replyTrend.some((p) => p.n > 0) && (
        <div className="mb-4 rounded-xl border border-neutral-200 bg-white p-4">
          <div className="mb-2 text-sm font-medium">
            Median first reply, day by day{" "}
            <span className="text-xs font-normal text-neutral-400">
              · trailing {d.replyTrend.length} days · hover a bar for detail
            </span>
          </div>
          {(() => {
            const pts = d.replyTrend;
            const W = 940;
            const H = 140;
            const PB = 18;
            const max = Math.max(...pts.map((p) => p.medianMs ?? 0), 1);
            const bw = W / pts.length;
            const fmtDay = (day: string) =>
              new Date(day + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
            const labelEvery = Math.ceil(pts.length / 7);
            return (
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Median first-reply time per day">
                {[0.5, 1].map((f) => (
                  <g key={f}>
                    <line x1={0} x2={W} y1={H - PB - f * (H - PB - 14)} y2={H - PB - f * (H - PB - 14)} stroke="#f1f1ef" />
                    <text x={2} y={H - PB - f * (H - PB - 14) - 3} fontSize={9} fill="#a3a3a3">
                      {fmtDuration(max * f)}
                    </text>
                  </g>
                ))}
                {pts.map((p, i) => {
                  const h = p.medianMs ? Math.max(((p.medianMs / max) * (H - PB - 14)), 3) : 0;
                  const x = i * bw + bw * 0.18;
                  return (
                    <g key={p.day}>
                      {p.n > 0 ? (
                        <rect x={x} y={H - PB - h} width={bw * 0.64} height={h} rx={2} fill="var(--color-gold)" opacity={0.85}>
                          <title>{`${fmtDay(p.day)} — median ${fmtDuration(p.medianMs)} · ${p.n} first repl${p.n === 1 ? "y" : "ies"}`}</title>
                        </rect>
                      ) : (
                        <circle cx={x + bw * 0.32} cy={H - PB - 2} r={1.5} fill="#d4d4d4">
                          <title>{`${fmtDay(p.day)} — no first replies`}</title>
                        </circle>
                      )}
                      {i % labelEvery === 0 && (
                        <text x={x + bw * 0.32} y={H - 5} fontSize={9} fill="#a3a3a3" textAnchor="middle">
                          {fmtDay(p.day)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
            );
          })()}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="mb-2 text-sm font-medium">
            Response times <span className="text-xs font-normal text-neutral-400">({d.responseTimes.sinceDays}d window)</span>
          </div>
          <div className="space-y-1 text-xs text-neutral-600">
            <div className="flex justify-between">
              <span>Median first reply</span>
              <span className="font-semibold">{fmtDuration(d.responseTimes.overall.medianMs)}</span>
            </div>
            <div className="flex justify-between">
              <span>P90 first reply</span>
              <span className="font-semibold">{fmtDuration(d.responseTimes.overall.p90Ms)}</span>
            </div>
            <div className="flex justify-between">
              <span>Median resolution</span>
              <span className="font-semibold">{fmtDuration(d.responseTimes.overall.medianResolutionMs)}</span>
            </div>
            <div className="flex justify-between">
              <span>Awaiting first reply</span>
              <span className={`font-semibold ${d.responseTimes.awaitingFirstReply.length ? "text-amber-700" : ""}`}>
                {d.responseTimes.awaitingFirstReply.length}
              </span>
            </div>
          </div>
          {d.responseTimes.awaitingFirstReply.length > 0 && (
            <div className="mt-2 space-y-1 border-t border-neutral-100 pt-2 text-xs">
              {d.responseTimes.awaitingFirstReply.slice(0, 5).map((t) => (
                <Link key={t.ticketId} href={`/tickets/${t.ticketId}`} className="flex justify-between hover:underline">
                  <span className="truncate text-neutral-700">{t.subject ?? "(no subject)"}</span>
                  <span className="ml-2 flex-shrink-0 text-amber-700">{fmtDuration(t.waitingMs)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="mb-2 text-sm font-medium">Workload (open assigned)</div>
          {d.workload.length ? (
            <div className="space-y-1 text-xs text-neutral-600">
              {d.workload.map((w) => (
                <div key={w.label} className="flex justify-between">
                  <span>{w.label}</span>
                  <span className="font-semibold">{w.n}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-neutral-400">Nothing assigned right now.</p>
          )}
        </div>
      </div>
    </div>
  );
}
