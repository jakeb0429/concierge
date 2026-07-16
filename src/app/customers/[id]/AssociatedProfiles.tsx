"use client";

import { useState } from "react";
import Link from "next/link";
import type { ClusterMember } from "@/lib/customer-links";

/**
 * Associated profiles — the same person under multiple emails. Shows the
 * current cluster, lets a rep associate another email (or a related-customer
 * candidate in one click), and detach mistakes. Once associated, order/boat
 * lookups and draft context span every email in the cluster.
 */
export default function AssociatedProfiles({
  customerId,
  initialMembers,
  relatedCandidates,
}: {
  customerId: string;
  initialMembers: ClusterMember[];
  relatedCandidates: { customerId: string | null; email: string; name: string | null }[];
}) {
  const [members, setMembers] = useState<ClusterMember[]>(initialMembers);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const api = `/api/customers/${customerId}/link`;
  const memberEmails = new Set(members.map((m) => m.email?.toLowerCase()).filter(Boolean));

  async function call(method: "POST" | "DELETE", body: Record<string, string>) {
    setBusy(JSON.stringify(body));
    setError(null);
    const res = await fetch(api, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setError(data.error ?? "That didn’t work.");
      return;
    }
    setMembers(data.members);
    setEmail("");
  }

  const associable = relatedCandidates.filter((r) => !memberEmails.has(r.email.toLowerCase()));

  return (
    <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
      <div className="mb-1 text-sm font-medium">Associated profiles</div>
      <p className="mb-2 text-xs text-neutral-500">
        Same person, different email addresses. Orders, boats, and draft context are looked up across
        every address here.
      </p>

      {members.length > 1 ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {members.map((m) => (
            <span
              key={m.id}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
                m.isPrimary ? "bg-blue-50 text-blue-800" : "bg-neutral-100 text-neutral-700"
              }`}
            >
              {m.id === customerId ? (
                <span className="font-medium">{m.email ?? m.displayName ?? m.id}</span>
              ) : (
                <Link href={`/customers/${m.id}`} className="font-medium hover:underline">
                  {m.email ?? m.displayName ?? m.id}
                </Link>
              )}
              {m.isPrimary && <span className="text-[10px] uppercase tracking-wide">primary</span>}
              {!m.isPrimary && (
                <button
                  onClick={() => call("DELETE", { customerId: m.id })}
                  disabled={!!busy}
                  className="text-neutral-400 hover:text-red-700"
                  title="Detach from this cluster"
                >
                  ✕
                </button>
              )}
            </span>
          ))}
        </div>
      ) : (
        <p className="mb-3 text-xs text-neutral-400">No associated addresses yet.</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && email.includes("@") && call("POST", { email })}
          placeholder="other-address@example.com"
          className="w-60 rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
        />
        <button
          onClick={() => call("POST", { email })}
          disabled={!email.includes("@") || !!busy}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
        >
          Associate email
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}

      {associable.length > 0 && (
        <div className="mt-3 border-t border-neutral-100 pt-2">
          <div className="mb-1 text-xs text-neutral-500">From “possible related customers” below:</div>
          <div className="flex flex-wrap gap-2">
            {associable.slice(0, 6).map((r) => (
              <button
                key={r.email}
                onClick={() => (r.customerId ? call("POST", { customerId: r.customerId }) : call("POST", { email: r.email }))}
                disabled={!!busy}
                className="rounded-full border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
                title={r.name ?? r.email}
              >
                + {r.email}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
