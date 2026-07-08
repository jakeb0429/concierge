"use client";

import { useState } from "react";

type ExpiredNote = {
  id: string;
  body: string;
  expiresAt: string;
  href: string;
  scopeLabel: string;
};

/**
 * The admin's expiry prompt: a note's date passed ("PO260501 expected Aug 1"),
 * so the fact needs a decision — still true (make permanent), pushed out
 * (extend 30 days), or no longer needed (remove). Expired notes already
 * stopped feeding drafts; this queue keeps the record honest.
 */
export default function ExpiredNotesReview({ notes: initial }: { notes: ExpiredNote[] }) {
  const [notes, setNotes] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, action: "extend" | "permanent" | "remove") {
    setBusy(id);
    const res =
      action === "remove"
        ? await fetch(`/api/notes/${id}`, { method: "DELETE" })
        : await fetch(`/api/notes/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expiresAt: action === "permanent" ? null : new Date(Date.now() + 30 * 86_400_000).toISOString(),
            }),
          });
    setBusy(null);
    if (res.ok) setNotes((xs) => xs.filter((n) => n.id !== id));
  }

  if (notes.length === 0) return null;
  return (
    <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
      <div className="mb-2 text-xs font-medium text-amber-800">
        {notes.length} context note{notes.length > 1 ? "s" : ""} expired — did what they describe happen?
      </div>
      <div className="space-y-2">
        {notes.map((n) => (
          <div key={n.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs">
            <span className="flex-1 leading-relaxed text-neutral-700">{n.body}</span>
            <a href={n.href} className="text-blue-600 hover:underline">
              {n.scopeLabel}
            </a>
            <span className="text-neutral-400">expired {new Date(n.expiresAt).toLocaleDateString()}</span>
            <button
              onClick={() => act(n.id, "extend")}
              disabled={busy === n.id}
              className="rounded-lg border border-neutral-200 px-2 py-1 hover:bg-neutral-50 disabled:opacity-40"
              title="Not yet — push the date out 30 days"
            >
              Extend 30d
            </button>
            <button
              onClick={() => act(n.id, "permanent")}
              disabled={busy === n.id}
              className="rounded-lg border border-neutral-200 px-2 py-1 hover:bg-neutral-50 disabled:opacity-40"
              title="Still true with no end date — keep it"
            >
              Keep — no expiry
            </button>
            <button
              onClick={() => act(n.id, "remove")}
              disabled={busy === n.id}
              className="rounded-lg bg-neutral-900 px-2 py-1 text-white hover:bg-neutral-700 disabled:opacity-40"
              title="It happened / no longer needed — remove the note"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
