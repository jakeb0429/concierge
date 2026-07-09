import Link from "next/link";
import { polylinePoints } from "@/lib/analytics";

/** Any labeled point series plots — weekly counts, monthly revenue, etc. */
type Pt = { label: string; n: number };

/**
 * Server-rendered analytics building blocks — no client JS. Hover detail rides
 * on native <title> tooltips, interactivity on plain <Link> query params, the
 * same idiom as the rest of the app. Series colors are the validated pair
 * scribe-blue #2e74b5 / gold #a8882e; text stays in neutral ink.
 */

export function StatTile({
  label,
  value,
  sub,
  href,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string | null;
  href?: string;
  tone?: "amber" | "green" | "violet";
}) {
  const toneClass = tone === "amber" ? "text-amber-700" : tone === "green" ? "text-green-700" : tone === "violet" ? "text-violet-700" : "";
  const body = (
    <>
      <div className="text-xs text-neutral-400">{label}</div>
      <div className={`text-2xl font-semibold ${toneClass}`}>{value}</div>
      {sub && <div className="text-[11px] text-neutral-400">{sub}</div>}
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-xl border border-neutral-200 bg-white p-4 transition-colors hover:border-gold">
      {body}
    </Link>
  ) : (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">{body}</div>
  );
}

/** One labeled horizontal bar — the list form for magnitude-by-identity. */
export function BarRow({
  label,
  n,
  max,
  href,
  color = "bg-scribe-blue",
  right,
  title,
}: {
  label: string;
  n: number;
  max: number;
  href?: string;
  color?: string;
  right?: string;
  title?: string;
}) {
  const inner = (
    <>
      <div className="w-40 truncate text-xs text-neutral-500">{label}</div>
      <div className="h-4 flex-1 rounded bg-neutral-100">
        <div className={`h-4 rounded ${color}`} style={{ width: `${(n / Math.max(1, max)) * 100}%`, minWidth: n ? 3 : 0 }} />
      </div>
      <div className="w-24 text-right text-xs text-neutral-600">{right ?? n.toLocaleString()}</div>
    </>
  );
  const cls = "flex items-center gap-2 rounded px-1 py-0.5";
  return href ? (
    <Link href={href} className={`${cls} hover:bg-neutral-50`} title={title}>
      {inner}
    </Link>
  ) : (
    <div className={cls} title={title}>
      {inner}
    </div>
  );
}

/** Two aligned series as thin SVG lines with end labels + legend. */
export function TrendChart({
  a,
  b,
  aLabel,
  bLabel,
  fmt = (v: number) => v.toLocaleString(),
}: {
  a: Pt[];
  b: Pt[];
  aLabel: string;
  bLabel: string;
  fmt?: (v: number) => string;
}) {
  const W = 720;
  const H = 120;
  const max = Math.max(1, ...a.map((p) => p.n), ...b.map((p) => p.n));
  const scaleA = a.map((p) => p.n);
  const scaleB = b.map((p) => p.n);
  // Both series share one y-scale (one axis — never dual).
  const pts = (vals: number[]) => polylinePoints(vals, W, H, 4, max);
  const stepX = a.length > 1 ? (W - 8) / (a.length - 1) : 0;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${aLabel} vs ${bLabel} per week`}>
        {/* recessive baseline grid */}
        <line x1="0" y1={H - 4} x2={W} y2={H - 4} stroke="#e5e5e5" strokeWidth="1" />
        <line x1="0" y1={4} x2={W} y2={4} stroke="#f3f3f3" strokeWidth="1" />
        <polyline points={pts(scaleA)} fill="none" stroke="#2e74b5" strokeWidth="2" strokeLinejoin="round" />
        <polyline points={pts(scaleB)} fill="none" stroke="#a8882e" strokeWidth="2" strokeLinejoin="round" />
        {a.map((p, i) => (
          <g key={p.label}>
            {/* invisible wide hit target with native tooltip per week */}
            <rect x={4 + i * stepX - stepX / 2} y="0" width={Math.max(stepX, 12)} height={H} fill="transparent">
              <title>{`${p.label}: ${fmt(p.n)} ${aLabel.toLowerCase()} · ${fmt(b[i]?.n ?? 0)} ${bLabel.toLowerCase()}`}</title>
            </rect>
            <circle cx={4 + i * stepX} cy={H - 4 - (p.n / max) * (H - 8)} r="2.5" fill="#2e74b5" />
            <circle cx={4 + i * stepX} cy={H - 4 - ((b[i]?.n ?? 0) / max) * (H - 8)} r="2.5" fill="#a8882e" />
          </g>
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-neutral-400">
        <span>{a[0]?.label}</span>
        <span>{a[Math.floor(a.length / 2)]?.label}</span>
        <span>{a.at(-1)?.label}</span>
      </div>
      <div className="mt-1 flex gap-4 text-xs text-neutral-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: "#2e74b5" }} /> {aLabel} (max {fmt(Math.max(...scaleA))})
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: "#a8882e" }} /> {bLabel} (max {fmt(Math.max(...scaleB))})
        </span>
      </div>
    </div>
  );
}

/** Filter pills row — Link-driven, current value highlighted. */
export function FilterPills({
  options,
  current,
  hrefFor,
}: {
  options: { value: string; label: string }[];
  current: string;
  hrefFor: (value: string) => string;
}) {
  return (
    <div className="flex gap-1.5 text-xs">
      {options.map((o) => (
        <Link
          key={o.value}
          href={hrefFor(o.value)}
          className={`rounded-full px-3 py-1 ${current === o.value ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-neutral-100"}`}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}
