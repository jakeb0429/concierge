"use client";

import { useEffect, useRef, useState } from "react";
import { coverageChip, statusChip, statusLabel } from "@/lib/ui";

type Draft = {
  draftId: string;
  body: string;
  coverage: string;
  coverageNote: string | null;
  policyFlags: string[];
  citations: { id: string; title: string; score: number }[];
};
type Msg = { direction: string; subject: string | null; text: string; sentAt: string };
type Ticket = {
  id: string;
  subject: string;
  status: string;
  priority: string;
  customerName: string;
  customerEmail: string;
};

const STEER_CHIPS = ["Warmer", "Shorter", "More detail", "Add next steps", "More formal"];

export default function TicketWorkspace({
  ticket,
  messages,
  initialDraft,
}: {
  ticket: Ticket;
  messages: Msg[];
  initialDraft: Draft | null;
}) {
  const [draft, setDraft] = useState<Draft | null>(initialDraft);
  const [body, setBody] = useState(initialDraft?.body ?? "");
  const [status, setStatus] = useState(ticket.status);
  const [generating, setGenerating] = useState(false);
  const [steer, setSteer] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(status === "replied" || status === "resolved");
  const started = useRef(false);

  async function generate(steerNotes?: string) {
    setGenerating(true);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steerNotes, regenOfDraftId: draft?.draftId }),
      });
      const d: Draft = await res.json();
      setDraft(d);
      setBody(d.body);
      setStatus("in_review");
      setSteer("");
    } finally {
      setGenerating(false);
    }
  }

  // Auto-prepare a first draft on open when none exists and it's not already sent.
  useEffect(() => {
    if (!started.current && !initialDraft && !sent) {
      started.current = true;
      generate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function confirm() {
    if (!draft) return;
    setSending(true);
    try {
      await fetch(`/api/tickets/${ticket.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: draft.draftId, finalBody: body }),
      });
      setSent(true);
      setStatus("replied");
    } finally {
      setSending(false);
    }
  }

  const inbound = messages.filter((m) => m.direction === "inbound");
  const outbound = messages.filter((m) => m.direction === "outbound");

  return (
    <div className="mt-3">
      {/* header */}
      <div className="mb-3 flex items-center justify-between rounded-xl border border-neutral-200 bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-xs font-medium text-blue-700">
            {ticket.customerName.split(" ").map((s) => s[0]).slice(0, 2).join("")}
          </div>
          <div>
            <div className="text-sm font-medium">{ticket.customerName}</div>
            <div className="text-xs text-neutral-400">
              {ticket.customerEmail} · via hello@rheosgear.com
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {ticket.priority === "high" && (
            <span className="rounded-full bg-red-50 px-2 py-1 text-[11px] text-red-700">high</span>
          )}
          <span className={`rounded-full px-2.5 py-1 text-[11px] ${statusChip(status)}`}>
            {statusLabel(status)}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2">
        {/* conversation */}
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="mb-2 text-xs text-neutral-400">Conversation</div>
          <div className="space-y-3">
            {inbound.map((m, i) => (
              <div key={i} className="text-sm leading-relaxed">
                <div className="mb-1 text-xs text-neutral-400">{ticket.customerName}</div>
                <p className="whitespace-pre-wrap text-neutral-800">{m.text}</p>
              </div>
            ))}
            {outbound.map((m, i) => (
              <div key={`o${i}`} className="rounded-lg bg-green-50 p-3 text-sm leading-relaxed">
                <div className="mb-1 text-xs text-green-700">Sent reply</div>
                <p className="whitespace-pre-wrap text-neutral-800">{m.text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* draft */}
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs text-neutral-400">{sent ? "Sent" : "First draft · edit inline"}</div>
            {draft && (
              <span className={`rounded-full px-2 py-0.5 text-[11px] ${coverageChip(draft.coverage)}`}>
                {draft.coverage === "full" ? "fully covered" : draft.coverage === "partial" ? "partial" : "not covered"}
              </span>
            )}
          </div>

          {generating && !draft ? (
            <div className="py-10 text-center text-sm text-neutral-400">Preparing draft…</div>
          ) : (
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={sent}
              rows={8}
              className="w-full resize-none rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm leading-relaxed text-neutral-800 outline-none focus:border-neutral-300 disabled:opacity-70"
            />
          )}

          {draft?.coverageNote && (
            <div className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {draft.coverageNote}
            </div>
          )}
          {draft?.policyFlags?.map((f, i) => (
            <div key={i} className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              ⚠ {f}
            </div>
          ))}
        </div>
      </div>

      {/* steer */}
      {!sent && (
        <div className="mt-3 rounded-xl border border-neutral-300 bg-white p-4">
          <div className="mb-2 text-xs text-neutral-400">
            Steer the draft — changes tone and emphasis, not the facts
          </div>
          <div className="mb-2 flex flex-wrap gap-2">
            {STEER_CHIPS.map((c) => (
              <button
                key={c}
                onClick={() => generate(c)}
                disabled={generating}
                className="rounded-full border border-neutral-200 px-3 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
              >
                {c}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={steer}
              onChange={(e) => setSteer(e.target.value)}
              placeholder="Or tell the draft what to change…"
              className="flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-300"
            />
            <button
              onClick={() => generate(steer || undefined)}
              disabled={generating}
              className="whitespace-nowrap rounded-lg border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
            >
              {generating ? "Regenerating…" : "↻ Regenerate"}
            </button>
          </div>
        </div>
      )}

      {/* citations */}
      {draft && draft.citations.length > 0 && (
        <div className="mt-3 rounded-xl border border-neutral-200 bg-white p-4">
          <div className="mb-2 text-xs text-neutral-400">Grounded in Brand Brain</div>
          <div className="flex flex-wrap gap-2">
            {draft.citations.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-1.5 text-xs text-blue-700"
              >
                {c.title}
                <span className="opacity-60">{c.score.toFixed(2)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* actions */}
      {!sent ? (
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={confirm}
            disabled={sending || generating || !draft}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {sending ? "Sending…" : "Confirm and send"}
          </button>
          <span className="text-xs text-neutral-400">Send is the only outbound action — logged until live send is enabled.</span>
        </div>
      ) : (
        <div className="mt-3 rounded-lg bg-green-50 px-4 py-2 text-sm text-green-700">
          Reply sent. This ticket is now marked replied.
        </div>
      )}

      <Assist />
    </div>
  );
}

function Assist() {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<{ id: string; title: string }[]>([]);
  const [loading, setLoading] = useState(false);

  async function ask() {
    if (!q.trim()) return;
    setLoading(true);
    setAnswer(null);
    try {
      const res = await fetch("/api/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const d = await res.json();
      setAnswer(d.answer);
      setSources(d.sources ?? []);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-neutral-200 bg-white p-4">
      <div className="mb-2 text-xs text-neutral-400">Ask the Brain — internal only, never sent to the customer</div>
      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
          placeholder="e.g. what's our warranty fee again?"
          className="flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-300"
        />
        <button
          onClick={ask}
          disabled={loading}
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
        >
          {loading ? "…" : "Ask"}
        </button>
      </div>
      {answer && (
        <div className="mt-3 text-sm leading-relaxed text-neutral-800">
          <p className="whitespace-pre-wrap">{answer}</p>
          {sources.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {sources.map((s) => (
                <span key={s.id} className="rounded bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500">
                  {s.title}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
