"use client";

import { useState } from "react";

/**
 * One place to teach the platform something while replying. The scope decides
 * where the fact lives and what it grounds:
 *   this ticket    — this conversation only (ContextNote)
 *   this customer  — all their tickets (ContextNote)
 *   product        — every ticket mentioning the family (ContextNote)
 *   brand FAQ      — proposed Brand Brain entry (gated in the training queue)
 * Notes can expire ("in stock when PO arrives — Aug 1"); the admin gets the
 * did-it-happen prompt when they lapse. Optionally regenerates the draft so
 * the new fact lands in the reply immediately.
 */
export default function ContextComposer({
  ticketId,
  customerId,
  productFamily,
  onSaved,
}: {
  ticketId: string;
  customerId: string;
  productFamily: string | null;
  onSaved: (regen: boolean) => void;
}) {
  const [body, setBody] = useState("");
  const [scope, setScope] = useState<"ticket" | "customer" | "product" | "faq">("ticket");
  const [expires, setExpires] = useState("");
  const [regen, setRegen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function save() {
    if (!body.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      let res: Response;
      if (scope === "faq") {
        res = await fetch(`/api/tickets/${ticketId}/teach`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: body }),
        });
      } else {
        res = await fetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body,
            ...(scope === "ticket" ? { ticketId } : scope === "customer" ? { customerId } : { productFamily }),
            expiresAt: expires || null,
          }),
        });
      }
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice(d.error ?? "Save failed.");
        return;
      }
      setNotice(
        scope === "faq"
          ? "Proposed to the Brand Brain — it grounds drafts once approved in the training queue."
          : `Saved${regen ? " — regenerating the draft with it…" : "."}`
      );
      setBody("");
      setExpires("");
      onSaved(scope !== "faq" && regen);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-l-4 border-amber-200/70 border-l-amber-400 bg-amber-50/30 p-4">
      <div className="mb-2 text-xs font-medium text-neutral-500">
        Add context — a fact the reply (and future drafts) should know
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder='e.g. "Back in stock when PO260501 arrives — expected Aug 1"'
          className="min-w-72 flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-300"
        />
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as typeof scope)}
          className="rounded-lg border border-neutral-200 px-2 py-2 text-xs text-neutral-600"
          title="Where this fact applies"
        >
          <option value="ticket">this ticket only</option>
          <option value="customer">this customer (all tickets)</option>
          {productFamily && <option value="product">product: {productFamily}</option>}
          <option value="faq">brand FAQ (needs approval)</option>
        </select>
        {scope !== "faq" && (
          <label className="flex items-center gap-1 text-xs text-neutral-400">
            expires
            <input
              type="date"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
              className="rounded-lg border border-neutral-200 px-2 py-1.5"
            />
          </label>
        )}
        {scope !== "faq" && (
          <label className="flex items-center gap-1 text-xs text-neutral-500" title="Regenerate the draft so this fact lands in the reply now">
            <input type="checkbox" checked={regen} onChange={(e) => setRegen(e.target.checked)} className="accent-neutral-700" />
            regen draft
          </label>
        )}
        <button onClick={save} disabled={busy || !body.trim()} className="btn-primary px-3 py-2 text-xs">
          {busy ? "Saving…" : "Save context"}
        </button>
      </div>
      {notice && <p className="mt-2 text-xs text-neutral-500">{notice}</p>}
    </div>
  );
}
