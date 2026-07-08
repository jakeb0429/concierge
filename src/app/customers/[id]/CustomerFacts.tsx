"use client";

import { useState } from "react";

/**
 * The rep-maintained purchase-channel facts + the AI read. Channel facts are
 * the context no data feed can see (which dealer sold the boat, that they
 * shop at a local retailer) — saving them refreshes the AI read next view.
 */
export default function CustomerFacts({
  customerId,
  purchaseChannel,
  channelName,
  insight,
}: {
  customerId: string;
  purchaseChannel: string | null;
  channelName: string | null;
  insight: string | null;
}) {
  const [channel, setChannel] = useState(purchaseChannel ?? "");
  const [name, setName] = useState(channelName ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = channel !== (purchaseChannel ?? "") || name !== (channelName ?? "");

  async function save() {
    setBusy(true);
    const res = await fetch(`/api/customers/${customerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purchaseChannel: channel || null, channelName: name || null }),
    });
    setBusy(false);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => window.location.reload(), 600);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-neutral-200 bg-white px-5 py-4">
      {insight && (
        <div className="mb-3 rounded-lg border border-blue-100 bg-blue-50/50 px-3 py-2 text-sm leading-relaxed text-neutral-700">
          <span className="mr-2 text-xs font-medium text-blue-700">Customer read</span>
          {insight}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">Buys via</span>
        <select
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          className="rounded-lg border border-neutral-200 px-2 py-1.5 text-sm"
        >
          <option value="">unknown</option>
          <option value="direct">Direct (our store)</option>
          <option value="retail">Retail</option>
          <option value="dealer">Dealer</option>
        </select>
        {(channel === "retail" || channel === "dealer") && (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={channel === "dealer" ? "Which dealer?" : "Which retailer?"}
            className="w-56 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm"
          />
        )}
        {dirty && (
          <button
            onClick={save}
            disabled={busy}
            className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs text-white hover:bg-neutral-700 disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        )}
        {saved && <span className="text-xs text-green-700">Saved — refreshing the read…</span>}
      </div>
    </div>
  );
}
