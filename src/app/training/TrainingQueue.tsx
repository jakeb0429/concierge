"use client";

import { useState } from "react";
import { categoryLabel } from "@/lib/categories";

type TrainingSignal = {
  id: string;
  kind: string;
  target: string;
  category: string | null;
  itemTitle: string | null;
  currentAnswer: string | null;
  proposedText: string | null;
  occurrences: number;
  repNote: string | null;
  createdAt: string;
};

const TARGET_EXPLAIN: Record<string, string> = {
  answer: "updates an existing entry (version bump)",
  voice_guide: "adds a standing voice rule",
  avoid_note: "adds a do-not-use phrasing",
  new_entry: "creates a new entry — only when nothing existing fits",
};

export default function TrainingQueue({ signals: initial }: { signals: TrainingSignal[] }) {
  const [signals, setSignals] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function resolve(id: string, action: "approve" | "dismiss") {
    setBusy(id);
    const res = await fetch(`/api/signals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setBusy(null);
    if (res.ok) setSignals((xs) => xs.filter((s) => s.id !== id));
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="page-title">My training queue</h1>
        <p className="text-sm text-neutral-500">
          Proposed Brain changes in your specialty — approving updates the knowledge every draft is
          grounded in. Prefer refining an existing entry over adding a new one.
        </p>
      </div>

      {signals.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white px-4 py-10 text-center text-sm text-neutral-400">
          Nothing waiting on you — new training questions land here when tickets in your specialty
          teach the Brain something.
        </div>
      ) : (
        <div className="space-y-3">
          {signals.map((s) => (
            <div key={s.id} className="rounded-xl border border-amber-200 bg-white p-4">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">
                  {s.kind.replace(/_/g, " ")} · seen {s.occurrences}×
                </span>
                {s.category && (
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600">
                    {categoryLabel(s.category)}
                  </span>
                )}
                {s.itemTitle && <span>on “{s.itemTitle}”</span>}
                <span className="text-neutral-400">→ {TARGET_EXPLAIN[s.target] ?? s.target.replace(/_/g, " ")}</span>
                <span className="ml-auto text-neutral-400">{new Date(s.createdAt).toLocaleDateString()}</span>
              </div>
              <p className="text-sm leading-relaxed text-neutral-800">{s.proposedText}</p>
              {s.repNote && <p className="mt-1 text-[11px] text-neutral-400">Rep&apos;s note: “{s.repNote}”</p>}
              {s.currentAnswer && (
                <button
                  onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                  className="mt-1 text-[11px] text-neutral-400 underline hover:text-neutral-700"
                >
                  {expanded === s.id ? "hide current answer" : "compare with current answer"}
                </button>
              )}
              {expanded === s.id && s.currentAnswer && (
                <p className="mt-1 rounded-lg bg-neutral-50 p-2 text-xs leading-relaxed text-neutral-500">
                  {s.currentAnswer}
                </p>
              )}
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => resolve(s.id, "approve")}
                  disabled={busy === s.id}
                  className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  Approve — update the Brain
                </button>
                <button
                  onClick={() => resolve(s.id, "dismiss")}
                  disabled={busy === s.id}
                  className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs hover:bg-neutral-50 disabled:opacity-50"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
