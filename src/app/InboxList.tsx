"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { statusChip, statusLabel } from "@/lib/ui";
import { REPLY_STATE_CHIP, REPLY_STATE_LABEL, type ReplyState } from "@/lib/reply-state";
import { categoryChipClass } from "@/lib/categories";
import { PRIORITIES, PRIORITY_LABEL, priorityChip } from "@/lib/priority";

export type Row = {
  id: string;
  name: string;
  subject: string;
  snippet: string;
  status: string;
  category: string | null;
  categoryKey?: string | null;
  mailboxTag: string | null;
  urgent: boolean;
  priority: string;
  replyState: ReplyState;
  looksNoise: boolean;
  assigneeId: string | null;
  assigneeLabel: string | null;
  waitingDays: number | null;
  needsReply: boolean;
  createdAt: number;
  lastReplyAt: number | null;
  lastActivityAt: number;
  maybeHandled?: boolean;
};

export type AssignableUser = { id: string; label: string };

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Status transitions a rep can apply straight from the list. */
function statusOptions(current: string): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = [{ value: current, label: statusLabel(current) }];
  if (["new", "in_review", "drafted", "replied"].includes(current)) {
    opts.push({ value: "resolved", label: "→ Resolve" }, { value: "archived", label: "→ Archive" });
  }
  if (["resolved", "archived", "replied"].includes(current)) opts.push({ value: "new", label: "→ Reopen" });
  return opts;
}

/**
 * The inbox table. Column headers sort (click again to flip); the default
 * importance view keeps its urgent/unassigned/answered bands as labeled
 * sections inside the same table. Status and assignee change inline.
 */
export default function InboxList({
  rows,
  view,
  flat = false,
  sort = null,
  dir = "desc",
  canAssign = false,
  users = [],
}: {
  rows: Row[];
  view: string;
  flat?: boolean;
  sort?: string | null;
  dir?: "asc" | "desc";
  canAssign?: boolean;
  users?: AssignableUser[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function patchTicket(ticketId: string, body: object) {
    const res = await fetch(`/api/tickets/${ticketId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) router.refresh();
    else alert((await res.json().catch(() => ({ error: "Update failed" }))).error);
  }

  const sortHref = (key: string) => {
    const next = new URLSearchParams(params.toString());
    if (sort === key) next.set("dir", dir === "desc" ? "asc" : "desc");
    else {
      next.set("sort", key);
      next.delete("dir");
    }
    return `/?${next.toString()}`;
  };
  const arrow = (key: string) => (sort === key ? (dir === "desc" ? " ↓" : " ↑") : "");

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
      setTimeout(() => router.refresh(), 900);
    } finally {
      setBusy(false);
    }
  }

  // Grouping — same bands as before, now as table sections.
  let groups: { key: string; title: string | null; tone?: "urgent" | "noise"; rows: Row[] }[];
  if (flat) {
    groups = [{ key: "flat", title: null, rows }];
  } else if (view === "noise") {
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
    const answered = rows.filter((r) => !r.urgent && !r.looksNoise && !unassignedIds.has(r.id) && !r.needsReply);
    const rest = rows.filter((r) => !r.urgent && !r.looksNoise && !unassignedIds.has(r.id) && r.needsReply);
    groups = [
      ...(urgent.length ? [{ key: "urgent", title: `Answer first — urgent (${urgent.length})`, tone: "urgent" as const, rows: urgent }] : []),
      ...(unassigned.length
        ? [{ key: "unassigned", title: `Needs an owner — unassigned (${unassigned.length})`, rows: unassigned }]
        : []),
      { key: "rest", title: rest.length ? `Working queue (${rest.length})` : null, rows: rest },
      ...(answered.length
        ? [{ key: "answered", title: `Answered — waiting on the customer (${answered.length})`, rows: answered }]
        : []),
      ...(noiseLooking.length
        ? [{ key: "noise", title: `Looks like vendor pitches & automated mail (${noiseLooking.length})`, tone: "noise" as const, rows: noiseLooking }]
        : []),
    ];
  } else {
    groups = [{ key: "all", title: null, rows }];
  }

  const th = (label: string, key: string, extra = "") => (
    <th className={`px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-warm-grey ${extra}`}>
      <Link href={sortHref(key)} className="hover:text-gold">
        {label}
        {arrow(key)}
      </Link>
    </th>
  );

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

      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full min-w-[880px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-cream">
              <th className="w-8 px-2 py-2"></th>
              {th("Customer", "customer", "w-40")}
              <th className="px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-warm-grey">
                Subject
              </th>
              {th("Category", "category", "w-36")}
              {th("Urgency", "priority", "w-24")}
              {th("Assignee", "assignee", "w-32")}
              {th("Status", "status", "w-32")}
              {th("Received", "received", "w-20")}
              {th("Last reply", "lastreply", "w-24")}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <TableGroup
                key={g.key}
                group={g}
                selected={selected}
                toggle={toggle}
                toggleGroup={toggleGroup}
                canAssign={canAssign}
                users={users}
                view={view}
                patchTicket={patchTicket}
              />
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-sm text-neutral-400">
                  Nothing here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TableGroup({
  group: g,
  selected,
  toggle,
  toggleGroup,
  canAssign,
  users,
  view,
  patchTicket,
}: {
  group: { key: string; title: string | null; tone?: "urgent" | "noise"; rows: Row[] };
  selected: Set<string>;
  toggle: (id: string) => void;
  toggleGroup: (ids: string[]) => void;
  canAssign: boolean;
  users: AssignableUser[];
  view: string;
  patchTicket: (id: string, body: object) => Promise<void>;
}) {
  return (
    <>
      {g.title && (
        <tr>
          <td
            colSpan={9}
            className={`border-b border-neutral-100 px-3 py-1.5 text-xs font-medium ${
              g.tone === "urgent" ? "bg-red-50 text-red-700" : "bg-cream text-warm-grey"
            }`}
          >
            <span className="flex items-center gap-2">
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
            </span>
          </td>
        </tr>
      )}
      {g.rows.map((t) => (
        <tr
          key={t.id}
          className={`border-b border-neutral-100 last:border-0 hover:bg-neutral-50 ${
            t.urgent ? "border-l-4 border-l-red-500" : ""
          }`}
        >
          <td className="px-2 py-2 align-middle">
            <input
              type="checkbox"
              checked={selected.has(t.id)}
              onChange={() => toggle(t.id)}
              className="h-3.5 w-3.5 accent-neutral-700"
            />
          </td>
          <td className="max-w-40 px-2 py-2 align-middle">
            <Link href={`/tickets/${t.id}`} className="block">
              <span className="block truncate text-sm font-medium text-neutral-800">{t.name}</span>
              <span className="mt-0.5 flex flex-wrap gap-1">
                {t.urgent && (
                  <span className="rounded-full bg-red-600 px-1.5 text-[10px] font-semibold text-white">URGENT</span>
                )}
                {t.mailboxTag && (
                  <span className="rounded-full bg-purple-50 px-1.5 text-[10px] text-purple-700">{t.mailboxTag}</span>
                )}
                {t.maybeHandled && (
                  <span
                    className="rounded-full bg-teal-50 px-1.5 text-[10px] text-teal-700"
                    title="A shipment, refund, or new order happened after this request — it may already be handled"
                  >
                    possibly handled
                  </span>
                )}
              </span>
            </Link>
          </td>
          <td className="max-w-0 px-2 py-2 align-middle">
            <Link href={`/tickets/${t.id}`} className="block">
              <span className="block truncate text-sm text-neutral-800">{t.subject || "(no subject)"}</span>
              <span className="block truncate text-xs text-neutral-400">{t.snippet}</span>
            </Link>
          </td>
          <td className="px-2 py-2 align-middle">
            {t.category && (
              <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] ${categoryChipClass(t.categoryKey)}`}>
                {t.category.replace(/_/g, " ")}
              </span>
            )}
          </td>
          <td className="px-2 py-2 align-middle">
            <select
              value={t.priority}
              onChange={(e) => {
                if (e.target.value !== t.priority) patchTicket(t.id, { priority: e.target.value });
              }}
              title="Change urgency"
              className={`w-full cursor-pointer rounded-lg border border-transparent px-1.5 py-1 text-[11px] hover:border-neutral-300 ${priorityChip(t.priority)}`}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </td>
          <td className="px-2 py-2 align-middle">
            {canAssign && view !== "noise" && !t.looksNoise ? (
              <select
                value={t.assigneeId ?? ""}
                onChange={(e) => patchTicket(t.id, { assigneeId: e.target.value || null })}
                title="Assign this ticket"
                className={`w-full rounded-lg border px-1.5 py-1 text-[11px] ${
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
                <span className="inline-block rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-700">
                  {t.assigneeLabel}
                </span>
              )
            )}
          </td>
          <td className="px-2 py-2 align-middle">
            <select
              value={t.status}
              onChange={(e) => {
                if (e.target.value !== t.status) patchTicket(t.id, { status: e.target.value });
              }}
              title="Change status"
              className={`w-full cursor-pointer rounded-lg border border-transparent px-1.5 py-1 text-[11px] hover:border-neutral-300 ${statusChip(t.status)}`}
            >
              {statusOptions(t.status).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </td>
          <td className="px-2 py-2 align-middle text-xs text-neutral-500" title={new Date(t.createdAt).toLocaleString()}>
            {fmtDate(t.createdAt)}
          </td>
          <td className="px-2 py-2 align-middle text-xs">
            {t.lastReplyAt ? (
              <span className="text-neutral-500" title={new Date(t.lastReplyAt).toLocaleString()}>
                {fmtDate(t.lastReplyAt)}
              </span>
            ) : t.needsReply ? (
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${REPLY_STATE_CHIP[t.replyState]}`}>
                {t.waitingDays !== null && t.waitingDays >= 1 ? `waiting ${t.waitingDays}d` : REPLY_STATE_LABEL[t.replyState]}
              </span>
            ) : (
              <span className="text-neutral-300">—</span>
            )}
          </td>
        </tr>
      ))}
    </>
  );
}
