"use client";

import { useState } from "react";

type Source = {
  id: string;
  key: string;
  label: string;
  kind: string;
  channelType: string;
  notes: string | null;
  active: boolean;
  lastSyncAt: string | null;
  orders: number;
  revenue: number;
  latestOrder: string | null;
};

const KIND_LABEL: Record<string, string> = {
  shopify: "Shopify",
  hubspot_deals: "HubSpot deals",
  erp: "ERP / dealer feed",
  manual: "Aggregates only",
};

export default function SourcesPanel({ tenantName, sources }: { tenantName: string; sources: Source[] }) {
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(s: Source) {
    setBusy(s.id);
    const res = await fetch(`/api/sources/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !s.active }),
    });
    setBusy(null);
    if (res.ok) window.location.reload();
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">Sales data — {tenantName}</h1>
        <p className="text-sm text-neutral-500">
          The order streams feeding customer history, lifetime value, and the AI customer read.
          Configured per brand for now; credentials live on the server, not here.
        </p>
      </div>

      <div className="space-y-3">
        {sources.map((s) => (
          <div key={s.id} className={`rounded-xl border bg-white p-4 ${s.active ? "border-neutral-200" : "border-dashed border-neutral-300"}`}>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="font-medium">{s.label}</span>
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] uppercase tracking-wide text-neutral-500">
                {s.channelType}
              </span>
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500">
                {KIND_LABEL[s.kind] ?? s.kind}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] ${
                  s.active ? "bg-green-50 text-green-700" : "bg-neutral-100 text-neutral-400"
                }`}
              >
                {s.active ? "active" : "inactive"}
              </span>
              <button
                onClick={() => toggle(s)}
                disabled={busy === s.id}
                className="ml-auto rounded-lg border border-neutral-200 px-2.5 py-1 text-xs text-neutral-500 hover:bg-neutral-50 disabled:opacity-40"
              >
                {s.active ? "Deactivate" : "Activate"}
              </button>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-neutral-500">
              {s.orders > 0 ? (
                <>
                  <span>
                    <span className="font-semibold text-neutral-800">{s.orders.toLocaleString()}</span> orders
                  </span>
                  <span>
                    <span className="font-semibold text-neutral-800">
                      ${s.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>{" "}
                    total
                  </span>
                  {s.latestOrder && <span>latest {new Date(s.latestOrder).toLocaleDateString()}</span>}
                </>
              ) : (
                <span className="text-neutral-400">no per-customer orders from this source</span>
              )}
              {s.lastSyncAt && <span>synced {new Date(s.lastSyncAt).toLocaleString()}</span>}
            </div>
            {s.notes && <p className="mt-2 text-xs leading-relaxed text-neutral-400">{s.notes}</p>}
          </div>
        ))}
        {sources.length === 0 && (
          <div className="rounded-xl border border-neutral-200 bg-white px-4 py-10 text-center text-sm text-neutral-400">
            No sales sources configured for this brand yet.
          </div>
        )}
      </div>
    </div>
  );
}
