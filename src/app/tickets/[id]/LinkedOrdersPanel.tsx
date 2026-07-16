"use client";

import { useState } from "react";
import type { LinkedOrder, OrderCandidate } from "@/lib/ticket-orders";

/**
 * Rep-confirmed orders on a ticket. Attach by pasting an order # / hull id,
 * or run the profile lookup (cluster emails → confirmed, name match →
 * verify-first). Linked orders become authoritative draft grounding.
 */
export default function LinkedOrdersPanel({
  ticketId,
  initial,
}: {
  ticketId: string;
  initial: LinkedOrder[];
}) {
  const [linked, setLinked] = useState<LinkedOrder[]>(initial);
  const [candidates, setCandidates] = useState<OrderCandidate[] | null>(null);
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const api = `/api/tickets/${ticketId}/orders`;

  async function attach(body: { ref?: string; orderId?: string; via?: string }) {
    setBusy("attach");
    setError(null);
    const res = await fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setError(data.error ?? "Couldn’t attach that order.");
      return;
    }
    setLinked(data.linked);
    setRef("");
    if (candidates) setCandidates(candidates.filter((c) => !data.linked.some((l: LinkedOrder) => l.orderId === c.orderId)));
  }

  async function unlink(linkId: string) {
    setBusy(linkId);
    const res = await fetch(api, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ linkId }) });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (res.ok) setLinked(data.linked);
  }

  async function lookup() {
    setBusy("lookup");
    setError(null);
    const res = await fetch(`${api}?lookup=1`);
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setError(data.error ?? "Lookup failed.");
      return;
    }
    setCandidates(data.candidates);
    if (!data.candidates.length) setError("No orders found under this customer’s emails or name.");
  }

  const fmtDate = (d: string | Date) =>
    new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  const orderLine = (o: { orderRef: string; description: string | null; totalAmount: number; orderedAt: string | Date }) =>
    o.description ?? `#${o.orderRef}${o.totalAmount ? ` · $${o.totalAmount.toLocaleString()}` : ""}`;

  return (
    <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
      <div className="mb-1 flex items-baseline justify-between">
        <div className="text-sm font-medium">Orders on this ticket</div>
        <span className="text-xs text-neutral-400">
          {linked.length ? `${linked.length} linked` : "none linked yet"}
        </span>
      </div>
      <p className="mb-2 text-xs text-neutral-500">
        Link the order(s) this conversation is about — drafts treat them as confirmed facts.
      </p>

      {linked.length > 0 && (
        <div className="mb-3 divide-y divide-neutral-100">
          {linked.map((l) => (
            <div key={l.linkId} className="flex items-center gap-2 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate text-neutral-800">{orderLine(l)}</span>
              <span className="flex-shrink-0 text-xs text-neutral-400">
                {fmtDate(l.orderedAt)}
                {l.via === "lookup" ? " · via lookup" : ""}
              </span>
              <button
                onClick={() => unlink(l.linkId)}
                disabled={busy === l.linkId}
                className="flex-shrink-0 rounded px-1.5 text-xs text-neutral-400 hover:bg-red-50 hover:text-red-700"
                title="Unlink"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ref.trim() && attach({ ref })}
          placeholder="Order # or hull ID…"
          className="w-48 rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
        />
        <button
          onClick={() => attach({ ref })}
          disabled={!ref.trim() || busy === "attach"}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
        >
          Link order
        </button>
        <button
          onClick={lookup}
          disabled={busy === "lookup"}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
        >
          {busy === "lookup" ? "Looking up…" : "Look up from customer profile"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}

      {candidates && candidates.length > 0 && (
        <div className="mt-3 rounded-lg border border-neutral-100 bg-neutral-50 p-2">
          <div className="mb-1 px-1 text-xs font-medium text-neutral-500">
            Found {candidates.length} — attach the one(s) this ticket is about
          </div>
          <div className="divide-y divide-neutral-100">
            {candidates.map((c) => (
              <div key={c.orderId} className="flex items-center gap-2 px-1 py-1.5 text-sm">
                <span className="min-w-0 flex-1 truncate text-neutral-800">{orderLine(c)}</span>
                <span
                  className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
                    c.confidence === "email" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
                  }`}
                  title={c.confidence === "email" ? `matches ${c.email}` : `name match on “${c.buyerName ?? ""}” — verify`}
                >
                  {c.confidence === "email" ? "email match" : "name match — verify"}
                </span>
                <button
                  onClick={() => attach({ orderId: c.orderId, via: "lookup" })}
                  disabled={busy === "attach"}
                  className="flex-shrink-0 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs hover:bg-neutral-100"
                >
                  Attach
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
