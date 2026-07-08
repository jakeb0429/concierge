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

  // Every number drills down to its records; clicking again collapses.
  const tile = (label: string, value: string | number, key: DrillKey, tone?: "amber" | "red") => (
    <Link
      href={drillHref(key)}
      className={`block rounded-xl border bg-white p-4 transition-colors hover:border-gold ${show === key ? "border-gold" : "border-neutral-200"}`}
    >
      <div className="text-xs text-neutral-400">{label}</div>
      <div className={`text-2xl font-semibold ${tone === "amber" ? "text-amber-700" : tone === "red" ? "text-red-700" : ""}`}>
        {value}
      </div>
      <div className="text-[10px] text-neutral-300">{show === key ? "hide records" : "view records"}</div>
    </Link>
  );

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
        {tile("New inquiries", d.newTickets, "new")}
        {tile("Replies sent", d.repliesSent, "replies")}
        {tile("Noise filtered", d.noiseFiltered, "noise")}
        {tile("Brain changes", d.brainChanges, "brain")}
      </div>
      {d.newByCategory.length > 0 && (
        <div className="mb-4 rounded-xl border border-neutral-200 bg-white p-4 text-xs">
          <div className="mb-2 text-sm font-medium">New inquiries by type</div>
          <div className="flex flex-wrap gap-2">
            {d.newByCategory.map((c) => (
              <span key={c.category} className="rounded-full bg-neutral-100 px-2.5 py-1 text-neutral-600">
                {c.label} · {c.n}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* where things stand right now */}
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-400">Right now</div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {tile("Need a reply", d.needsReply, "needsreply", d.needsReply > 0 ? "amber" : undefined)}
        {tile("Urgent open", d.urgentOpen, "urgent", d.urgentOpen > 0 ? "red" : undefined)}
        {tile("Unassigned", d.unassigned, "unassigned", d.unassigned > 0 ? "amber" : undefined)}
        {tile("Training pending", d.trainingOpen, "training")}
        {tile("Expired notes", d.expiredNotes, "expired", d.expiredNotes > 0 ? "amber" : undefined)}
      </div>

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
