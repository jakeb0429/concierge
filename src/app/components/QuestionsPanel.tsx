"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type QuestionReplyRow = {
  id: string;
  authorId: string;
  authorLabel: string;
  body: string;
  createdAt: string;
};

export type QuestionRow = {
  id: string;
  body: string;
  status: string; // open | answered | closed
  askedById: string;
  askedByLabel: string;
  assigneeId: string | null;
  assigneeLabel: string | null;
  createdAt: string;
  replies: QuestionReplyRow[];
};

export type TeamUser = { id: string; label: string };

const STATUS_CHIP: Record<string, string> = {
  open: "bg-amber-50 text-amber-800 ring-amber-600/20",
  answered: "bg-green-50 text-green-800 ring-green-600/20",
  closed: "bg-neutral-100 text-neutral-500 ring-neutral-500/15",
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Internal Q&A on a ticket — shared between the full workspace (CS asks) and
 * the Simple View's Q&A page (teammates answer). Everything here is
 * team-internal; nothing reaches the customer.
 */
export default function QuestionsPanel({
  ticketId,
  meId,
  users,
  questions,
  isAdmin = false,
}: {
  ticketId: string;
  meId: string | null;
  users: TeamUser[];
  questions: QuestionRow[];
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const [ask, setAsk] = useState("");
  const [askWho, setAskWho] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // Which question's reassign form is open, plus its pending picks.
  const [reassignFor, setReassignFor] = useState<string | null>(null);
  const [reassignTo, setReassignTo] = useState("");
  const [reassignComment, setReassignComment] = useState("");

  function openReassign(qid: string) {
    setReassignFor((cur) => (cur === qid ? null : qid));
    setReassignTo("");
    setReassignComment("");
  }

  async function submitReassign(qid: string) {
    if (busy || !reassignTo) return;
    if (
      await call(`/api/questions/${qid}/reassign`, "POST", {
        assigneeId: reassignTo,
        comment: reassignComment.trim() || undefined,
      })
    ) {
      setReassignFor(null);
      setReassignTo("");
      setReassignComment("");
    }
  }

  async function call(url: string, method: string, body: object) {
    setBusy(true);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        alert((await res.json().catch(() => ({ error: "Request failed" }))).error);
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function submitQuestion() {
    if (busy || ask.trim().length < 3) return; // Enter-key path must respect in-flight too
    if (await call(`/api/tickets/${ticketId}/questions`, "POST", { body: ask.trim(), assigneeId: askWho || null })) {
      setAsk("");
      setAskWho("");
    }
  }

  async function submitReply(qid: string) {
    const text = (replyDrafts[qid] ?? "").trim();
    if (busy || !text) return; // Enter-key path must respect in-flight too
    if (await call(`/api/questions/${qid}/replies`, "POST", { body: text })) {
      setReplyDrafts((d) => ({ ...d, [qid]: "" }));
    }
  }

  return (
    <div className="mb-3 rounded-xl border border-l-4 border-amber-200/70 border-l-amber-400 bg-amber-50/30 p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-warm-grey">Team Q&amp;A</span>
        <span className="text-[11px] text-neutral-400">internal only — the customer never sees this</span>
      </div>

      {questions.length === 0 && (
        <p className="mb-3 text-xs text-neutral-400">No questions on this ticket yet.</p>
      )}

      <div className="space-y-3">
        {questions.map((q) => (
          <div key={q.id} className={`rounded-lg border px-3 py-2.5 ${q.status === "closed" ? "border-neutral-100 bg-neutral-50" : "border-neutral-200"}`}>
            <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-neutral-400">
              <span className={`chip ${STATUS_CHIP[q.status] ?? STATUS_CHIP.open}`}>{q.status}</span>
              <span>
                <b className="font-medium text-neutral-600">{q.askedByLabel}</b> asked
                {q.assigneeLabel ? (
                  <>
                    {" "}
                    <b className="font-medium text-neutral-600">{q.assigneeLabel}</b>
                  </>
                ) : (
                  " the team"
                )}{" "}
                · {fmt(q.createdAt)}
              </span>
              <span className="ml-auto flex items-center gap-1.5">
                {q.status !== "closed" &&
                  (meId === q.assigneeId || meId === q.askedById || isAdmin) && (
                    <button
                      onClick={() => openReassign(q.id)}
                      disabled={busy}
                      className="rounded-lg border border-neutral-200 px-2 py-0.5 hover:bg-neutral-50 disabled:opacity-40"
                      title="Hand this off to a different teammate"
                    >
                      Reassign
                    </button>
                  )}
                {meId === q.askedById && q.status !== "closed" && (
                  <button
                    onClick={() => call(`/api/questions/${q.id}`, "PATCH", { status: "closed" })}
                    disabled={busy}
                    className="rounded-lg border border-neutral-200 px-2 py-0.5 hover:bg-neutral-50 disabled:opacity-40"
                    title="Got what you needed — clear it from the team's queue"
                  >
                    Close
                  </button>
                )}
                {meId === q.askedById && q.status === "closed" && (
                  <button
                    onClick={() => call(`/api/questions/${q.id}`, "PATCH", { status: "open" })}
                    disabled={busy}
                    className="rounded-lg border border-neutral-200 px-2 py-0.5 hover:bg-neutral-50 disabled:opacity-40"
                  >
                    Reopen
                  </button>
                )}
              </span>
            </div>
            <p className="whitespace-pre-wrap text-sm text-neutral-800">{q.body}</p>

            {reassignFor === q.id && q.status !== "closed" && (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/60 p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-medium text-neutral-600">Reassign to</span>
                  <select
                    value={reassignTo}
                    onChange={(e) => setReassignTo(e.target.value)}
                    className="rounded-lg border border-neutral-200 px-2 py-1.5 text-xs text-neutral-700"
                  >
                    <option value="">choose a teammate…</option>
                    {users
                      .filter((u) => u.id !== q.assigneeId)
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.label}
                        </option>
                      ))}
                  </select>
                </div>
                <input
                  value={reassignComment}
                  onChange={(e) => setReassignComment(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && reassignTo) {
                      e.preventDefault();
                      submitReassign(q.id);
                    }
                  }}
                  placeholder="Add a note for them (optional), e.g. why it's more their area"
                  className="mt-2 w-full rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => submitReassign(q.id)}
                    disabled={busy || !reassignTo}
                    className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-40"
                  >
                    Reassign
                  </button>
                  <button
                    onClick={() => setReassignFor(null)}
                    disabled={busy}
                    className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {q.replies.length > 0 && (
              <div className="mt-2 space-y-1.5 border-l-2 border-neutral-100 pl-3">
                {q.replies.map((r) => (
                  <div key={r.id}>
                    <span className="text-[11px] text-neutral-400">
                      <b className="font-medium text-neutral-600">{r.authorLabel}</b> · {fmt(r.createdAt)}
                    </span>
                    <p className="whitespace-pre-wrap text-sm text-neutral-700">{r.body}</p>
                  </div>
                ))}
              </div>
            )}

            {q.status !== "closed" && (
              <div className="mt-2 flex gap-2">
                <input
                  value={replyDrafts[q.id] ?? ""}
                  onChange={(e) => setReplyDrafts((d) => ({ ...d, [q.id]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submitReply(q.id);
                    }
                  }}
                  placeholder="Write an answer…"
                  className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm"
                />
                <button
                  onClick={() => submitReply(q.id)}
                  disabled={busy || !(replyDrafts[q.id] ?? "").trim()}
                  className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-40"
                >
                  Reply
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ask a new question */}
      <div className="mt-3 border-t border-neutral-100 pt-3">
        <div className="flex flex-wrap gap-2">
          <input
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submitQuestion();
              }
            }}
            placeholder='Ask the team, e.g. "Do we know who can help with this?"'
            className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-sm"
          />
          <select
            value={askWho}
            onChange={(e) => setAskWho(e.target.value)}
            title="Who should answer"
            className="rounded-lg border border-neutral-200 px-2 py-1.5 text-xs text-neutral-600"
          >
            <option value="">anyone</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
          <button
            onClick={submitQuestion}
            disabled={busy || ask.trim().length < 3}
            className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-40"
          >
            Ask
          </button>
        </div>
        <p className="mt-1 text-[11px] text-neutral-400">Named teammates get an email with a link straight to this ticket&apos;s Q&amp;A.</p>
      </div>
    </div>
  );
}
