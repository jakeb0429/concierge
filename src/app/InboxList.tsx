"use client";

import Link from "next/link";
import { useState } from "react";
import { statusChip, statusLabel } from "@/lib/ui";
import { REPLY_STATE_CHIP, REPLY_STATE_LABEL, type ReplyState } from "@/lib/reply-state";

export type Row = {
  id: string;
  name: string;
  subject: string;
  snippet: string;
  status: string;
  category: string | null;
  wholesale: boolean;
  urgent: boolean;
  replyState: ReplyState;
  looksNoise: boolean;
  assigneeId: string | null;
  assigneeLabel: string | null;
  waitingDays: number | null;
  needsReply: boolean;
  createdAt: number;
};

export type AssignableUser = { id: string; label: string };

/**
 * Inbox list with grouping + multi-select bulk archive.
 *   open view : urgent tickets pinned in a red "answer first" group; tickets
 *               that look like vendor pitches / automated mail grouped at the
 *               bottom with select-all — one click clears them (Gmail too)
 *   noise view: grouped by triage category with select-all per group
 */
export default function InboxList({
  rows,
  view,
  canAssign = false,
  users = [],
}: {
  rows: Row[];
  view: string;
  canAssign?: boolean;
  users?: AssignableUser[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function reassign(ticketId: string, assigneeId: string) {
    const res = await fetch(`/api/tickets/${ticketId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assigneeId: assigneeId || null }),
    });
    if (res.ok) window.location.reload();
    else alert((await res.json().catch(() => ({ error: "Reassign failed" }))).error);
  }

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleGroup = (ids: string[]) =>
    setSelected((s) => {
      const n = new Set(s);
      const allIn = ids.every((id) => n.has(id));
      ids.forEach((id) => (allIn ? n.delete(id) : n.add(id)));
      return n;
    });

  async function archiveSelected() {
    if (!selected.size) return;
    setBusy(true);
    try {
      const res = await fetch("/api/tickets/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "archive", ticketIds: [...selected] }),
      });
      const d = await res.json();
      if (!res.ok) {
        alert(d.error ?? "Bulk archive failed");
        return;
      }
      setNotice(
        `Archived ${d.archived} ticket${d.archived !== 1 ? "s" : ""} · ${d.providerArchived} thread${d.providerArchived !== 1 ? "s" : ""} also archived in the mailbox.`
      );
      setSelected(new Set());
      setTimeout(() => window.location.reload(), 1200);
    } finally {
      setBusy(false);
    }
  }

  // Build groups by view.
  let groups: { key: string; title: string | null; tone?: "urgent" | "noise"; rows: Row[] }[];
  if (view === "noise") {
    const byCat = new Map<string, Row[]>();
    for (const r of rows) {
      const k = r.category ?? "other";
      if (!byCat.has(k)) byCat.set(k, []);
      byCat.get(k)!.push(r);
    }
    groups = [...byCat.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([k, rs]) => ({ key: k, title: `${k.replace(/_/g, " ")} (${rs.length})`, tone: "noise" as const, rows: rs }));
  } else if (view === "open" || view === "mine") {
    const urgent = rows.filter((r) => r.urgent);
    const noiseLooking = rows.filter((r) => !r.urgent && r.looksNoise);
    const unassigned = canAssign ? rows.filter((r) => !r.urgent && !r.looksNoise && !r.assigneeId && r.needsReply) : [];
    const unassignedIds = new Set(unassigned.map((r) => r.id));
    const rest = rows.filter((r) => !r.urgent && !r.looksNoise && !unassignedIds.has(r.id));
    groups = [
      ...(urgent.length ? [{ key: "urgent", title: `Answer first — urgent (${urgent.length})`, tone: "urgent" as const, rows: urgent }] : []),
      ...(unassigned.length
        ? [{ key: "unassigned", title: `Needs an owner — unassigned (${unassigned.length})`, rows: unassigned }]
        : []),
      { key: "rest", title: null, rows: rest },
      ...(noiseLooking.length
        ? [{ key: "noise", title: `Looks like vendor pitches & automated mail (${noiseLooking.length})`, tone: "noise" as const, rows: noiseLooking }]
        : []),
    ];
  } else {
    groups = [{ key: "all", title: null, rows }];
  }

  return (
    <div>
      {/* bulk action bar */}
      {(selected.size > 0 || notice) && (
        <div className="mb-3 flex items-center gap-3 rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm">
          {notice ? (
            <span className="text-green-700">{notice}</span>
          ) : (
            <>
              <span className="text-neutral-600">{selected.size} selected</span>
              <button
                onClick={archiveSelected}
                disabled={busy}
                className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
              >
                {busy ? "Archiving…" : "Archive selected — also archives in Gmail"}
              </button>
              <button onClick={() => setSelected(new Set())} className="text-xs text-neutral-400 hover:text-neutral-700">
                Clear
              </button>
            </>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
        {groups.map((g) => (
          <div key={g.key}>
            {g.title && (
              <div
                className={`flex items-center gap-2 border-b border-neutral-100 px-4 py-2 text-xs font-medium ${
                  g.tone === "urgent" ? "bg-red-50 text-red-700" : "bg-neutral-50 text-neutral-500"
                }`}
              >
                {g.tone === "noise" && (
                  <input
                    type="checkbox"
                    checked={g.rows.length > 0 && g.rows.every((r) => selected.has(r.id))}
                    onChange={() => toggleGroup(g.rows.map((r) => r.id))}
                    title="Select all in this group"
                    className="h-3.5 w-3.5 accent-neutral-700"
                  />
                )}
                {g.tone === "urgent" && <span>⚠</span>}
                {g.title}
              </div>
            )}
            {g.rows.map((t) => (
              <div
                key={t.id}
                className={`flex items-center gap-3 border-b border-neutral-100 px-4 py-3 last:border-0 hover:bg-neutral-50 ${
                  t.urgent ? "border-l-4 border-l-red-500" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(t.id)}
                  onChange={() => toggle(t.id)}
                  className="h-3.5 w-3.5 flex-shrink-0 accent-neutral-700"
                />
                <Link href={`/tickets/${t.id}`} className="flex min-w-0 flex-1 items-center gap-4">
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-medium text-blue-700">
                    {t.name.split(" ").map((s) => s[0]).slice(0, 2).join("")}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{t.name}</span>
                      {t.urgent && (
                        <span className="rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                          URGENT
                        </span>
                      )}
                      <span className={`rounded-full px-2 py-0.5 text-[11px] ${REPLY_STATE_CHIP[t.replyState]}`}>
                        {REPLY_STATE_LABEL[t.replyState]}
                      </span>
                      {t.wholesale && (
                        <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[11px] text-purple-700">wholesale</span>
                      )}
                      {t.category && (
                        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500">
                          {t.category.replace(/_/g, " ")}
                        </span>
                      )}
                      {t.waitingDays !== null && t.waitingDays >= 1 && (
                        <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] text-orange-700">
                          waiting {t.waitingDays}d
                        </span>
                      )}
                    </div>
                    <div className="truncate text-sm text-neutral-700">{t.subject}</div>
                    <div className="truncate text-xs text-neutral-400">{t.snippet}</div>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] ${statusChip(t.status)}`}>
                    {statusLabel(t.status)}
                  </span>
                </Link>
                {canAssign ? (
                  <select
                    value={t.assigneeId ?? ""}
                    onChange={(e) => reassign(t.id, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    title="Assign this ticket"
                    className={`w-28 flex-shrink-0 rounded-lg border px-1.5 py-1 text-[11px] ${
                      t.assigneeId ? "border-neutral-200 text-neutral-600" : "border-amber-300 bg-amber-50 text-amber-800"
                    }`}
                  >
                    <option value="">unassigned</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  t.assigneeLabel && (
                    <span className="flex-shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-700">
                      {t.assigneeLabel}
                    </span>
                  )
                )}
              </div>
            ))}
          </div>
        ))}
        {rows.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-neutral-400">Nothing here.</div>
        )}
      </div>
    </div>
  );
}
