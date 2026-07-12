"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Arm = {
  id: string;
  sku: string;
  brand: string;
  container: number | null;
  leftCount: number;
  rightCount: number;
};

export default function PartsManager({ initialArms }: { initialArms: Arm[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Staged per-row count edits, keyed by id.
  const [edits, setEdits] = useState<Record<string, { leftCount: number; rightCount: number }>>({});
  const [draft, setDraft] = useState({ sku: "", brand: "", container: "", leftCount: "", rightCount: "" });

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return initialArms;
    return initialArms.filter((a) => a.sku.toLowerCase().includes(s) || a.brand.toLowerCase().includes(s));
  }, [q, initialArms]);

  const totals = useMemo(
    () => ({
      skus: initialArms.length,
      brands: new Set(initialArms.map((a) => a.brand)).size,
      arms: initialArms.reduce((n, a) => n + a.leftCount + a.rightCount, 0),
    }),
    [initialArms]
  );

  const editOf = (a: Arm) => edits[a.id] ?? { leftCount: a.leftCount, rightCount: a.rightCount };
  const isDirty = (a: Arm) => {
    const e = edits[a.id];
    return !!e && (e.leftCount !== a.leftCount || e.rightCount !== a.rightCount);
  };
  const setSide = (a: Arm, side: "leftCount" | "rightCount", value: number) => {
    const cur = editOf(a);
    setEdits((m) => ({ ...m, [a.id]: { ...cur, [side]: Math.max(0, value) } }));
  };

  async function save(a: Arm) {
    const e = editOf(a);
    setBusy(a.id);
    setNotice(null);
    try {
      const res = await fetch(`/api/parts/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leftCount: e.leftCount, rightCount: e.rightCount }),
      });
      if (!res.ok) {
        setNotice((await res.json().catch(() => ({})))?.error ?? "Save failed.");
        return;
      }
      setEdits((m) => {
        const next = { ...m };
        delete next[a.id];
        return next;
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function add() {
    const sku = draft.sku.trim();
    const brand = draft.brand.trim();
    if (!sku || !brand) {
      setNotice("SKU and model are required.");
      return;
    }
    setBusy("add");
    setNotice(null);
    try {
      const res = await fetch("/api/parts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku,
          brand,
          container: draft.container ? Number(draft.container) : null,
          leftCount: draft.leftCount ? Number(draft.leftCount) : 0,
          rightCount: draft.rightCount ? Number(draft.rightCount) : 0,
        }),
      });
      if (!res.ok) {
        setNotice((await res.json().catch(() => ({})))?.error ?? "Add failed.");
        return;
      }
      setDraft({ sku: "", brand: "", container: "", leftCount: "", rightCount: "" });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const numCls = "w-16 rounded-lg border border-neutral-300 px-2 py-1 text-sm tabular-nums";
  const stepBtn = "rounded-lg border border-neutral-200 px-1.5 py-1 text-xs text-neutral-500 hover:bg-cream/60";

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="page-title">Parts &amp; Replacements</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Replacement arm stock, by SKU. {totals.skus} SKUs across {totals.brands} models,{" "}
        {totals.arms.toLocaleString()} arms on hand. Left and right are tracked separately.
      </p>

      {notice && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{notice}</div>
      )}

      {/* Add a new arm SKU */}
      <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-warm-grey">Add an arm SKU</div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-neutral-500">
            SKU
            <input className="mt-0.5 block w-36 rounded-lg border border-neutral-300 px-2 py-1 text-sm" value={draft.sku} onChange={(e) => setDraft({ ...draft, sku: e.target.value })} placeholder="13003-00100" />
          </label>
          <label className="text-xs text-neutral-500">
            Model
            <input className="mt-0.5 block w-36 rounded-lg border border-neutral-300 px-2 py-1 text-sm" value={draft.brand} onChange={(e) => setDraft({ ...draft, brand: e.target.value })} placeholder="Bahias" />
          </label>
          <label className="text-xs text-neutral-500">
            Container
            <input className="mt-0.5 block w-20 rounded-lg border border-neutral-300 px-2 py-1 text-sm tabular-nums" value={draft.container} onChange={(e) => setDraft({ ...draft, container: e.target.value.replace(/\D/g, "") })} placeholder="1" />
          </label>
          <label className="text-xs text-neutral-500">
            Left
            <input className={`mt-0.5 block ${numCls}`} value={draft.leftCount} onChange={(e) => setDraft({ ...draft, leftCount: e.target.value.replace(/\D/g, "") })} placeholder="0" />
          </label>
          <label className="text-xs text-neutral-500">
            Right
            <input className={`mt-0.5 block ${numCls}`} value={draft.rightCount} onChange={(e) => setDraft({ ...draft, rightCount: e.target.value.replace(/\D/g, "") })} placeholder="0" />
          </label>
          <button onClick={add} disabled={busy === "add"} className="btn-primary">
            {busy === "add" ? "Adding…" : "Add"}
          </button>
        </div>
      </div>

      {/* Inventory table */}
      <div className="mt-4 overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by model or SKU…"
          className="w-full border-b border-neutral-100 px-4 py-2 text-sm outline-none placeholder:text-neutral-400"
        />
        <table className="w-full text-sm">
          <thead className="bg-cream">
            <tr className="text-left text-[11px] uppercase tracking-wide text-warm-grey">
              <th className="px-3 py-2">Model</th>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Container</th>
              <th className="px-3 py-2">Left</th>
              <th className="px-3 py-2">Right</th>
              <th className="px-3 py-2">Total</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => {
              const e = editOf(a);
              const dirty = isDirty(a);
              return (
                <tr key={a.id} className="border-b border-neutral-100 hover:bg-cream/40">
                  <td className="px-3 py-2 font-medium text-neutral-800">{a.brand}</td>
                  <td className="px-3 py-2 font-mono text-xs text-neutral-600">{a.sku}</td>
                  <td className="px-3 py-2 tabular-nums text-neutral-500">{a.container ?? "—"}</td>
                  {(["leftCount", "rightCount"] as const).map((side) => (
                    <td key={side} className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <button className={stepBtn} onClick={() => setSide(a, side, e[side] - 1)} aria-label={`decrement ${side}`}>
                          −
                        </button>
                        <input
                          className={numCls}
                          inputMode="numeric"
                          value={e[side]}
                          onChange={(ev) => setSide(a, side, Number(ev.target.value.replace(/\D/g, "") || 0))}
                        />
                        <button className={stepBtn} onClick={() => setSide(a, side, e[side] + 1)} aria-label={`increment ${side}`}>
                          +
                        </button>
                      </div>
                    </td>
                  ))}
                  <td className="px-3 py-2 tabular-nums text-neutral-500">{e.leftCount + e.rightCount}</td>
                  <td className="px-3 py-2">
                    {dirty && (
                      <button onClick={() => save(a)} disabled={busy === a.id} className="rounded-lg border border-gold/50 bg-gold/10 px-2 py-1 text-xs text-neutral-800 hover:bg-gold/20">
                        {busy === a.id ? "Saving…" : "Save"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-sm text-neutral-400">
                  No arms match “{q}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
