"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { INQUIRY_CATEGORIES, INQUIRY_CATEGORY_LABEL, type InquiryCategory } from "@/lib/categories";
import { PRIORITIES, PRIORITY_LABEL } from "@/lib/priority";

export type FilterUsers = { id: string; label: string }[];

/**
 * Inbox filter/sort toolbar. Every control writes a query param, so any
 * combination is a shareable "saved filter" URL — the digest tiles deep-link
 * here the same way. Active filters switch the list to a flat sorted view;
 * clearing them returns to the grouped importance view.
 */
export default function InboxFilters({ users, mailboxes = [] }: { users: FilterUsers; mailboxes?: string[] }) {
  const router = useRouter();
  const params = useSearchParams();

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`/?${next.toString()}`);
  };
  const active = ["cat", "assignee", "priority", "since", "needs", "sort", "mbx", "status"].some((k) => params.get(k));

  const sel = "rounded-lg border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-600";

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
      <span className="font-medium uppercase tracking-wide text-neutral-400">Filter</span>
      <select value={params.get("cat") ?? ""} onChange={(e) => set("cat", e.target.value)} className={sel} title="Category">
        <option value="">any category</option>
        {INQUIRY_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {INQUIRY_CATEGORY_LABEL[c as InquiryCategory]}
          </option>
        ))}
      </select>
      {mailboxes.length > 1 && (
        <select value={params.get("mbx") ?? ""} onChange={(e) => set("mbx", e.target.value)} className={sel} title="Mailbox">
          <option value="">any mailbox</option>
          {mailboxes.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      )}
      <select value={params.get("assignee") ?? ""} onChange={(e) => set("assignee", e.target.value)} className={sel} title="Assignee">
        <option value="">any assignee</option>
        <option value="none">unassigned</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.label}
          </option>
        ))}
      </select>
      <select value={params.get("priority") ?? ""} onChange={(e) => set("priority", e.target.value)} className={sel} title="Urgency">
        <option value="">any urgency</option>
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {PRIORITY_LABEL[p]} only
          </option>
        ))}
      </select>
      <select value={params.get("status") ?? ""} onChange={(e) => set("status", e.target.value)} className={sel} title="Status">
        <option value="">any status</option>
        <option value="new">new</option>
        <option value="drafted">drafted</option>
        <option value="in_review">in review</option>
        <option value="replied">replied</option>
        <option value="resolved">resolved</option>
        <option value="archived">archived</option>
      </select>
      <select value={params.get("since") ?? ""} onChange={(e) => set("since", e.target.value)} className={sel} title="Created within">
        <option value="">any time</option>
        <option value="24h">last 24h</option>
        <option value="7d">last 7 days</option>
        <option value="30d">last 30 days</option>
      </select>
      <select value={params.get("needs") ?? ""} onChange={(e) => set("needs", e.target.value)} className={sel} title="Reply state">
        <option value="">any reply state</option>
        <option value="1">needs a reply</option>
        <option value="0">already answered</option>
      </select>
      <span className="ml-2 font-medium uppercase tracking-wide text-neutral-400">Sort</span>
      <select value={params.get("sort") ?? ""} onChange={(e) => set("sort", e.target.value)} className={sel} title="Sort order">
        <option value="">importance (default)</option>
        <option value="newest">newest first</option>
        <option value="oldest">oldest first</option>
        <option value="waiting">waiting longest</option>
        <option value="priority">most urgent first</option>
        <option value="activity">recent activity</option>
      </select>
      {active && (
        <button onClick={() => router.push("/")} className="rounded-full bg-neutral-100 px-2.5 py-1 text-neutral-500 hover:bg-neutral-200">
          × clear filters
        </button>
      )}
    </div>
  );
}
