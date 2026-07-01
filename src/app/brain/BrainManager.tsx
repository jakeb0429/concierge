"use client";

import { useState } from "react";

type Item = {
  id: string;
  title: string;
  answer: string;
  category: string | null;
  kind: string;
  status: string;
  version: number;
  timesCited: number;
  sourceRef?: string | null;
};

export default function BrainManager({ initialItems }: { initialItems: Item[] }) {
  // Draft candidates (e.g. mined from HubSpot) surface first, awaiting approval.
  const [items, setItems] = useState(
    [...initialItems].sort((a, b) => (a.status === "draft" ? -1 : 0) - (b.status === "draft" ? -1 : 0))
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftAnswer, setDraftAnswer] = useState("");
  const [adding, setAdding] = useState(false);
  const [newItem, setNewItem] = useState({ title: "", answer: "", category: "" });

  async function save(id: string) {
    const res = await fetch(`/api/knowledge/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: draftTitle, answer: draftAnswer }),
    });
    const { item } = await res.json();
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...item } : x)));
    setEditing(null);
  }

  async function approve(id: string) {
    const res = await fetch(`/api/knowledge/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });
    const { item } = await res.json();
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...item } : x)));
  }

  async function create() {
    const res = await fetch("/api/knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newItem),
    });
    const { item } = await res.json();
    setItems((xs) => [item, ...xs]);
    setNewItem({ title: "", answer: "", category: "" });
    setAdding(false);
  }

  return (
    <div>
      <div className="mb-5 flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Brand Brain</h1>
          <p className="text-sm text-neutral-500">{items.length} entries · the knowledge that grounds every draft</p>
        </div>
        <button
          onClick={() => setAdding((a) => !a)}
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
        >
          + Add entry
        </button>
      </div>

      {adding && (
        <div className="mb-4 rounded-xl border border-neutral-300 bg-white p-4">
          <input
            value={newItem.title}
            onChange={(e) => setNewItem({ ...newItem, title: e.target.value })}
            placeholder="Title / question"
            className="mb-2 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-300"
          />
          <textarea
            value={newItem.answer}
            onChange={(e) => setNewItem({ ...newItem, answer: e.target.value })}
            placeholder="Canonical answer"
            rows={3}
            className="mb-2 w-full resize-none rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-300"
          />
          <div className="flex items-center gap-2">
            <input
              value={newItem.category}
              onChange={(e) => setNewItem({ ...newItem, category: e.target.value })}
              placeholder="Category"
              className="rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-300"
            />
            <button
              onClick={create}
              disabled={!newItem.title || !newItem.answer}
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Save entry
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {items.map((it) => (
          <div key={it.id} className="rounded-xl border border-neutral-200 bg-white p-4">
            {editing === it.id ? (
              <div>
                <input
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  className="mb-2 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-300"
                />
                <textarea
                  value={draftAnswer}
                  onChange={(e) => setDraftAnswer(e.target.value)}
                  rows={4}
                  className="mb-2 w-full resize-none rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-300"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => save(it.id)}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditing(null)}
                    className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm hover:bg-neutral-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-sm font-medium">{it.title}</span>
                  {it.status === "draft" && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                      pending approval
                    </span>
                  )}
                  {it.category && (
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500">
                      {it.category}
                    </span>
                  )}
                  <span className="text-[11px] text-neutral-400">
                    v{it.version} · cited {it.timesCited}×
                  </span>
                  <div className="ml-auto flex items-center gap-3">
                    {it.status === "draft" && (
                      <button
                        onClick={() => approve(it.id)}
                        className="rounded-lg bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700"
                      >
                        Approve
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setEditing(it.id);
                        setDraftTitle(it.title);
                        setDraftAnswer(it.answer);
                      }}
                      className="text-xs text-neutral-400 hover:text-neutral-900"
                    >
                      Edit
                    </button>
                  </div>
                </div>
                <p className="text-sm leading-relaxed text-neutral-700">{it.answer}</p>
                {it.sourceRef?.startsWith("hubspot") && (
                  <p className="mt-1 text-[11px] text-neutral-400">mined from {it.sourceRef}</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
