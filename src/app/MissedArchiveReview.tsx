"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export type MissedTicket = {
  id: string;
  subject: string;
  name: string;
  urgent: boolean;
  /** ISO time of the customer's last message, null if none recorded. */
  lastInboundAt: string | null;
  waitingDays: number | null;
};

/**
 * "Did you miss this?" — threads archived in Gmail while the ticket still
 * looked like live work (customer awaiting a reply, urgent, return in
 * flight). Restore reopens the ticket AND puts the thread back in the Gmail
 * inbox; dismiss confirms the archive was intentional and clears the warning.
 */
export default function MissedArchiveReview({ tickets: initial }: { tickets: MissedTicket[] }) {
  const router = useRouter();
  const [tickets, setTickets] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, action: "restore" | "dismiss") {
    setBusy(id);
    const res = await fetch(`/api/tickets/${id}/missed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setBusy(null);
    if (res.ok) {
      setTickets((xs) => xs.filter((t) => t.id !== id));
      if (action === "restore") router.refresh(); // the ticket rejoins the list below
    } else {
      alert((await res.json().catch(() => ({ error: "Update failed" }))).error);
    }
  }

  if (tickets.length === 0) return null;
  return (
    <div className="mb-3 rounded-xl border border-red-200 bg-red-50/60 p-4">
      <div className="mb-2 text-xs font-medium text-red-800">
        Did you miss {tickets.length === 1 ? "this" : "these"}? {tickets.length} thread
        {tickets.length > 1 ? "s were" : " was"} archived in Gmail while still looking like live work.
      </div>
      <div className="space-y-2">
        {tickets.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs">
            {t.urgent && (
              <span className="chip bg-red-50 text-red-800 ring-red-600/30">
                <span className="chip-dot bg-red-600" />
                Urgent
              </span>
            )}
            <Link href={`/tickets/${t.id}`} className="flex-1 truncate leading-relaxed text-neutral-700 hover:underline">
              <span className="font-medium">{t.name}</span> — {t.subject || "(no subject)"}
            </Link>
            {t.lastInboundAt && (
              <span className="text-neutral-400">
                customer wrote {new Date(t.lastInboundAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                {t.waitingDays !== null && t.waitingDays >= 1 ? ` · waiting ${t.waitingDays}d` : ""}
              </span>
            )}
            <button
              onClick={() => act(t.id, "restore")}
              disabled={busy === t.id}
              className="rounded-lg bg-neutral-900 px-2 py-1 text-white hover:bg-neutral-700 disabled:opacity-40"
              title="Reopen the ticket here and put the thread back in the Gmail inbox"
            >
              Restore to inbox
            </button>
            <button
              onClick={() => act(t.id, "dismiss")}
              disabled={busy === t.id}
              className="rounded-lg border border-neutral-200 px-2 py-1 hover:bg-neutral-50 disabled:opacity-40"
              title="It was archived on purpose — clear this warning and keep it archived"
            >
              Archived on purpose
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
