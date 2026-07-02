"use client";

import { useState } from "react";
import { coverageChip } from "@/lib/ui";

type Item = {
  draftId: string;
  ticketId: string;
  subject: string;
  customer: string;
  body: string;
  coverage: string;
  createdAt: string;
};

export default function ReviewQueue({ items: initial }: { items: Item[] }) {
  const [items, setItems] = useState(initial);
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function act(draftId: string, action: "approve" | "return") {
    await fetch(`/api/drafts/${draftId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, note: notes[draftId] || undefined }),
    });
    setItems((xs) => xs.filter((x) => x.draftId !== draftId));
  }

  return (
    <div className="space-y-3">
      {items.map((it) => (
        <div key={it.draftId} className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="mb-2 flex items-center gap-2">
            <a href={`/tickets/${it.ticketId}`} className="text-sm font-medium hover:underline">
              {it.customer} — {it.subject}
            </a>
            <span className={`rounded-full px-2 py-0.5 text-[11px] ${coverageChip(it.coverage)}`}>{it.coverage}</span>
            <span className="ml-auto text-xs text-neutral-400">
              {new Date(it.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </span>
          </div>
          <p className="mb-3 whitespace-pre-wrap rounded-lg bg-neutral-50 p-3 text-sm leading-relaxed text-neutral-800">{it.body}</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => act(it.draftId, "approve")}
              className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
            >
              Approve — rep can send
            </button>
            <input
              value={notes[it.draftId] ?? ""}
              onChange={(e) => setNotes((n) => ({ ...n, [it.draftId]: e.target.value }))}
              placeholder="Note for the rep (required to return)…"
              className="flex-1 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-neutral-300"
            />
            <button
              onClick={() => act(it.draftId, "return")}
              disabled={!notes[it.draftId]}
              className="rounded-lg border border-amber-300 px-3 py-1.5 text-sm text-amber-800 hover:bg-amber-50 disabled:opacity-40"
            >
              Return with note
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
