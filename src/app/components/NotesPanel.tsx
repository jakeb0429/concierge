"use client";

import { useState } from "react";

export type NoteRow = {
  id: string;
  body: string;
  scope: "ticket" | "customer" | "product";
  productFamily?: string | null;
  expiresAt: string | null;
  expired: boolean;
};

/**
 * Pinned context notes. On a ticket the rep chooses the scope (this ticket
 * only vs the customer — all their tickets); on the profile it's customer
 * scope. Notes can expire ("in stock when PO260501 arrives — expires Aug 1"):
 * expired notes stop feeding drafts and queue on the admin dashboard.
 */
export default function NotesPanel({
  notes: initial,
  ticketId,
  customerId,
}: {
  notes: NoteRow[];
  ticketId?: string;
  customerId: string;
}) {
  const [notes, setNotes] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [body, setBody] = useState("");
  const [scope, setScope] = useState<"ticket" | "customer">(ticketId ? "ticket" : "customer");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!body.trim()) return;
    setBusy(true);
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        body,
        ...(scope === "ticket" && ticketId ? { ticketId } : { customerId }),
        expiresAt: expires || null,
      }),
    });
    setBusy(false);
    if (!res.ok) return;
    const { note } = await res.json();
    setNotes((xs) => [
      { id: note.id, body: note.body, scope, expiresAt: note.expiresAt, expired: false },
      ...xs,
    ]);
    setBody("");
    setExpires("");
    setAdding(false);
  }

  async function remove(id: string) {
    setBusy(true);
    const res = await fetch(`/api/notes/${id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) setNotes((xs) => xs.filter((n) => n.id !== id));
  }

  return (
    <div className="mb-3 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-medium text-neutral-500">Context notes</span>
        <span className="text-neutral-400">
          {notes.length === 0 ? "— facts the team should know when replying" : ""}
        </span>
        <button
          onClick={() => setAdding((v) => !v)}
          className="ml-auto rounded-lg border border-neutral-200 px-2 py-0.5 text-[11px] text-neutral-500 hover:bg-neutral-50"
        >
          {adding ? "Cancel" : "+ Add note"}
        </button>
      </div>

      {adding && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder='e.g. "Back in stock when PO260501 arrives — expected Aug 1"'
            className="min-w-64 flex-1 rounded-lg border border-neutral-200 px-3 py-1.5"
          />
          {ticketId && (
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as "ticket" | "customer")}
              className="rounded-lg border border-neutral-200 px-2 py-1.5"
              title="Where this note applies"
            >
              <option value="ticket">this ticket only</option>
              <option value="customer">this customer (all tickets)</option>
            </select>
          )}
          <label className="flex items-center gap-1 text-neutral-400">
            expires
            <input
              type="date"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
              className="rounded-lg border border-neutral-200 px-2 py-1"
            />
          </label>
          <button
            onClick={add}
            disabled={busy || !body.trim()}
            className="btn-primary px-3 py-1.5"
          >
            Save note
          </button>
        </div>
      )}

      {notes.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {notes.map((n) => (
            <div
              key={n.id}
              className={`flex items-start gap-2 rounded-lg px-2 py-1.5 ${n.expired ? "bg-amber-50" : "bg-neutral-50"}`}
            >
              <span className="flex-1 leading-relaxed text-neutral-700">{n.body}</span>
              <span className="rounded-full bg-white px-2 py-0.5 text-[10px] text-neutral-400">
                {n.scope === "ticket" ? "this ticket" : n.scope === "product" ? `product: ${n.productFamily ?? "?"}` : "customer"}
              </span>
              {n.expiresAt && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] ${
                    n.expired ? "bg-amber-100 text-amber-800" : "bg-white text-neutral-400"
                  }`}
                >
                  {n.expired ? "expired" : "until"} {new Date(n.expiresAt).toLocaleDateString(undefined, { timeZone: "UTC" })}
                </span>
              )}
              <button
                onClick={() => remove(n.id)}
                disabled={busy}
                title="Remove note"
                className="text-neutral-300 hover:text-red-600"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
