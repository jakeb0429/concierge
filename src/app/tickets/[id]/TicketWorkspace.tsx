"use client";

import { useEffect, useRef, useState } from "react";
import { coverageChip, statusChip, statusLabel } from "@/lib/ui";
import { REPLY_STATE_CHIP, REPLY_STATE_LABEL, type ReplyState } from "@/lib/reply-state";

type Citation = {
  id: string;
  title: string;
  score: number;
  sourceRef?: string | null;
  version?: number;
};
type Draft = {
  draftId: string;
  body: string;
  coverage: string;
  coverageNote: string | null;
  policyFlags: string[];
  citations: Citation[];
  status?: string;
  reviewNote?: string | null;
};
type Attachment = { index: number; filename: string; isImage: boolean };
type Msg = {
  id: string;
  direction: string;
  subject: string | null;
  text: string;
  sentAt: string;
  attachments: Attachment[];
};
type Ticket = {
  id: string;
  subject: string;
  status: string;
  priority: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  mailbox: string;
};

type CustomerStats = {
  orders: number;
  totalSpend: number;
  firstSale: string | null;
  lastSale: string | null;
  returns: number;
  warrantyContacts: number;
  returnContacts: number;
  totalInquiries: number;
};

const STEER_CHIPS = ["Warmer", "Shorter", "More detail", "Add next steps", "More formal"];

export default function TicketWorkspace({
  ticket,
  messages,
  initialDraft,
  sentDraftId,
  customerStats,
  replyState,
  orderContext = [],
  gmailUrl,
}: {
  ticket: Ticket;
  messages: Msg[];
  initialDraft: Draft | null;
  sentDraftId: string | null;
  customerStats: CustomerStats;
  replyState?: ReplyState;
  orderContext?: { line: string; trackingUrl: string | null }[];
  gmailUrl?: string | null;
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

  // Auto-prepare a first draft on open — but never for archived/noise tickets;
  // those get a manual button instead so a stray open doesn't burn a model call.
  useEffect(() => {
    if (!started.current && !initialDraft && !sent && ticket.status !== "archived") {
      started.current = true;
      generate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [sentInfo, setSentInfo] = useState<{ to: string; live: boolean } | null>(null);
  const [reviewState, setReviewState] = useState<{ status: string; note: string | null }>({
    status: initialDraft?.status ?? "prepared",
    note: initialDraft?.reviewNote ?? null,
  });
  const [promoted, setPromoted] = useState(false);

  async function submitForReview() {
    if (!draft) return;
    const res = await fetch(`/api/drafts/${draft.draftId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "submit" }),
    });
    if (res.ok) setReviewState({ status: "pending_review", note: null });
  }

  async function setTicketStatus(next: string) {
    const res = await fetch(`/api/tickets/${ticket.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (res.ok) setStatus(next);
  }

  async function promote() {
    if (!sentDraftId) return;
    const res = await fetch(`/api/tickets/${ticket.id}/promote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId: sentDraftId }),
    });
    if (res.ok) setPromoted(true);
  }

  async function confirm() {
    if (!draft) return;
    setSending(true);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: draft.draftId, finalBody: body }),
      });
      const d = await res.json();
      if (!res.ok) {
        alert(d.error ?? "Send failed");
        return;
      }
      setSentInfo({ to: d.to, live: d.live });
      setSent(true);
      setStatus("replied");
    } finally {
      setSending(false);
    }
  }

  // Chronological thread — newest last, like a mail client.
  const thread = [...messages].sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <div className="mt-3">
      {/* header */}
      <div className="mb-3 flex items-center justify-between rounded-xl border border-neutral-200 bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-xs font-medium text-blue-700">
            {ticket.customerName.split(" ").map((s) => s[0]).slice(0, 2).join("")}
          </div>
          <div>
            <a href={`/customers/${ticket.customerId}`} className="text-sm font-medium hover:underline">
              {ticket.customerName}
            </a>
            <div className="text-xs text-neutral-400">
              {ticket.customerEmail} · via {ticket.mailbox}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {ticket.priority === "high" && (
            <span className="rounded-full bg-red-600 px-2 py-1 text-[11px] font-semibold text-white">URGENT</span>
          )}
          {replyState && (
            <span className={`rounded-full px-2 py-1 text-[11px] ${REPLY_STATE_CHIP[replyState]}`}>
              {REPLY_STATE_LABEL[replyState]}
            </span>
          )}
          <span className={`rounded-full px-2.5 py-1 text-[11px] ${statusChip(status)}`}>
            {statusLabel(status)}
          </span>
        </div>
      </div>

      {/* customer key stats — what the rep should know before replying */}
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-xs">
        {customerStats.orders > 0 ? (
          <>
            <span className="text-neutral-600">
              <span className="font-semibold text-neutral-900">{customerStats.orders}</span> order{customerStats.orders !== 1 ? "s" : ""}
            </span>
            <span className="text-neutral-600">
              <span className="font-semibold text-neutral-900">
                ${customerStats.totalSpend.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>{" "}
              lifetime
            </span>
            {customerStats.firstSale && (
              <span className="text-neutral-500">
                customer since{" "}
                {new Date(customerStats.firstSale).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
              </span>
            )}
            {customerStats.lastSale && (
              <span className="text-neutral-500">
                last order{" "}
                {new Date(customerStats.lastSale).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
            )}
            <span className={customerStats.returns > 0 ? "text-amber-700" : "text-neutral-500"}>
              {customerStats.returns} return{customerStats.returns !== 1 ? "s" : ""}
            </span>
          </>
        ) : (
          <span className="text-neutral-400">No purchase history under this email</span>
        )}
        <span className={customerStats.warrantyContacts > 0 ? "text-amber-700" : "text-neutral-500"}>
          {customerStats.warrantyContacts} warranty contact{customerStats.warrantyContacts !== 1 ? "s" : ""}
        </span>
        <span className="text-neutral-500">{customerStats.totalInquiries} total inquiries</span>
        <a href={`/customers/${ticket.customerId}`} className="ml-auto text-blue-600 hover:underline">
          full profile →
        </a>
      </div>

      {/* order context — live from the fulfillment system (ShipStation) */}
      {orderContext.length > 0 && (
        <div className="mb-3 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-xs">
          <span className="mr-3 font-medium text-neutral-500">Order status</span>
          {orderContext.map((o, i) => (
            <span key={i} className="mr-4 text-neutral-700">
              {o.line}
              {o.trackingUrl && (
                <>
                  {" "}
                  <a href={o.trackingUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                    track →
                  </a>
                </>
              )}
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2">
        {/* conversation */}
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="mb-2 flex items-baseline justify-between text-xs text-neutral-400">
            <span>Conversation</span>
            {gmailUrl && (
              <a
                href={gmailUrl}
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 hover:underline"
                title="Open the original thread in Gmail for additional review"
              >
                View original in Gmail ↗
              </a>
            )}
          </div>
          <div className="space-y-3">
            {thread.map((m, i) =>
              m.direction === "inbound" ? (
                <div key={i} className="rounded-lg bg-neutral-50 p-3 text-sm leading-relaxed">
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="text-xs font-medium text-neutral-500">{ticket.customerName}</span>
                    <span className="text-[11px] text-neutral-400">{fmtTime(m.sentAt)}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-neutral-800">{m.text}</p>
                  <AttachmentStrip msg={m} />
                </div>
              ) : (
                <div key={i} className="rounded-lg bg-green-50 p-3 text-sm leading-relaxed">
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="text-xs font-medium text-green-700">Rheos support</span>
                    <span className="text-[11px] text-green-700/70">{fmtTime(m.sentAt)}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-neutral-800">{m.text}</p>
                  <AttachmentStrip msg={m} />
                </div>
              )
            )}
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

          {!draft && !generating && ticket.status === "archived" ? (
            <div className="py-8 text-center">
              <p className="mb-3 text-sm text-neutral-400">
                Archived as noise — no draft was prepared automatically.
              </p>
              <button
                onClick={() => generate()}
                className="rounded-lg border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
              >
                Prepare a draft anyway
              </button>
            </div>
          ) : generating && !draft ? (
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

      {/* citations + teach the Brain */}
      <TeachBrain ticketId={ticket.id} draftId={draft?.draftId ?? null} citations={draft?.citations ?? []} />

      {/* review state banners */}
      {!sent && reviewState.status === "pending_review" && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Awaiting manager review — sending is locked until it&apos;s approved.
        </div>
      )}
      {!sent && reviewState.status === "approved" && (
        <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          Manager approved — ready to send.
        </div>
      )}
      {!sent && reviewState.note && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Returned by manager: “{reviewState.note}”
        </div>
      )}

      {/* actions */}
      {!sent ? (
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={confirm}
            disabled={sending || generating || !draft || reviewState.status === "pending_review"}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {sending ? "Sending…" : `Confirm and send → ${ticket.customerEmail || "no address"}`}
          </button>
          {reviewState.status !== "pending_review" && reviewState.status !== "approved" && (
            <button
              onClick={submitForReview}
              disabled={generating || !draft}
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
            >
              Submit for review
            </button>
          )}
          <span className="text-xs text-neutral-400">Replies go from {ticket.mailbox}.</span>
          <div className="ml-auto flex gap-2">
            <button onClick={() => setTicketStatus("resolved")} className="rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-600 hover:bg-neutral-50">
              Resolve
            </button>
            <button onClick={() => setTicketStatus("archived")} className="rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-600 hover:bg-neutral-50">
              Archive
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-green-50 px-4 py-2 text-sm text-green-700">
          <span>
            {sentInfo
              ? sentInfo.live
                ? `Reply sent to ${sentInfo.to} from ${ticket.mailbox}.`
                : `Reply logged (not transmitted — ${sentInfo.to} is a test/mock recipient or live send is off).`
              : "Reply sent. This ticket is now marked replied."}
          </span>
          {sentDraftId && !promoted && (
            <button onClick={promote} className="rounded-lg border border-green-300 px-3 py-1 text-xs text-green-800 hover:bg-green-100">
              Save answer to Brand Brain
            </button>
          )}
          {promoted && <span className="text-xs">Saved — pending approval in the Brain manager.</span>}
        </div>
      )}

      <Assist />
    </div>
  );
}

/**
 * Grounding sources + the rep's channel back into the Brain: correct a cited
 * entry that's wrong/out of date, or teach a learning the Brain doesn't have.
 * Submissions become LearningSignals — the Brain manager approves, nothing
 * mutates the Brain from here directly.
 */
function TeachBrain({
  ticketId,
  draftId,
  citations,
}: {
  ticketId: string;
  draftId: string | null;
  citations: Citation[];
}) {
  const [target, setTarget] = useState<Citation | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  async function submit() {
    if (!note.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/teach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note, knowledgeItemId: target?.id, draftId }),
      });
      const d = await res.json();
      if (!res.ok) {
        alert(d.error ?? "Couldn't submit");
        return;
      }
      setConfirmation(
        d.kind === "rep_correction"
          ? `Correction to “${d.itemTitle}” sent to the Brain manager for approval.`
          : `New learning “${d.itemTitle}” sent to the Brain manager for approval.`
      );
      setNote("");
      setTarget(null);
    } finally {
      setSubmitting(false);
    }
  }

  const provenance = (c: Citation) =>
    `v${c.version ?? 1}${c.sourceRef ? ` · ${c.sourceRef}` : ""}`;

  return (
    <div className="mt-3 rounded-xl border border-neutral-200 bg-white p-4">
      {citations.length > 0 && (
        <>
          <div className="mb-2 text-xs text-neutral-400">
            Grounded in Brand Brain — click ✎ if a source is wrong or out of date
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            {citations.map((c) => (
              <span
                key={c.id}
                title={provenance(c)}
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs ${
                  target?.id === c.id ? "bg-amber-100 text-amber-800" : "bg-blue-50 text-blue-700"
                }`}
              >
                <span>
                  {c.title}
                  <span className="ml-1.5 opacity-60">{c.score.toFixed(2)}</span>
                  <span className="ml-1.5 opacity-50">{provenance(c)}</span>
                </span>
                <button
                  onClick={() => setTarget(target?.id === c.id ? null : c)}
                  title={`Correct “${c.title}”`}
                  className="opacity-60 hover:opacity-100"
                >
                  ✎
                </button>
              </span>
            ))}
          </div>
        </>
      )}

      <div className="mb-2 text-xs text-neutral-400">
        {target ? (
          <>
            Correcting{" "}
            <span className="font-medium text-amber-700">
              “{target.title}” ({provenance(target)})
            </span>{" "}
            —{" "}
            <button onClick={() => setTarget(null)} className="text-blue-600 hover:underline">
              switch to a general learning
            </button>
          </>
        ) : (
          "Teach the Brain — add a learning or correction; a manager approves before it grounds drafts"
        )}
      </div>
      <div className="flex gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={
            target
              ? "What's wrong or out of date? e.g. that PO has arrived — no longer in process"
              : "e.g. new warranty policy: lenses now covered for 2 years"
          }
          className="flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-300"
        />
        <button
          onClick={submit}
          disabled={submitting || !note.trim()}
          className="whitespace-nowrap rounded-lg border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
        >
          {submitting ? "Submitting…" : target ? "Submit correction" : "Submit learning"}
        </button>
      </div>
      {confirmation && (
        <div className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {confirmation}{" "}
          <a href="/brain" className="text-blue-600 hover:underline">
            Review in the Brain manager →
          </a>
        </div>
      )}
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

function AttachmentStrip({ msg }: { msg: Msg }) {
  if (!msg.attachments.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {msg.attachments.map((a) =>
        a.isImage ? (
          <a
            key={a.index}
            href={`/api/attachments/${msg.id}/${a.index}`}
            target="_blank"
            rel="noreferrer"
            title={a.filename}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/attachments/${msg.id}/${a.index}`}
              alt={a.filename}
              className="h-24 w-24 rounded-lg border border-neutral-200 object-cover hover:opacity-90"
              loading="lazy"
            />
          </a>
        ) : (
          <a
            key={a.index}
            href={`/api/attachments/${msg.id}/${a.index}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50"
          >
            📎 {a.filename}
          </a>
        )
      )}
    </div>
  );
}
