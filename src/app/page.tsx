import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { computeReplyState, REPLY_STATE_LABEL, type ReplyState } from "@/lib/reply-state";
import { NOISE_CATEGORIES } from "@/lib/triage";
import InboxList, { type Row } from "./InboxList";

export const dynamic = "force-dynamic";

import type { Prisma } from "@prisma/client";

const VIEWS: Record<string, { label: string; where: Prisma.TicketWhereInput }> = {
  open: { label: "Open", where: { status: { notIn: ["archived", "resolved"] } } },
  noise: { label: "Noise", where: { status: "archived" } },
  all: { label: "All", where: {} },
};
type ViewKey = "open" | "noise" | "all";
const REPLY_FILTERS: ReplyState[] = ["first_contact", "follow_up", "waiting_customer"];

export default async function Inbox({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; reply?: string }>;
}) {
  const tenant = await getCurrentTenant();
  const { view: rawView, reply: rawReply } = await searchParams;
  const view: ViewKey = rawView === "noise" || rawView === "all" ? rawView : "open";
  const replyFilter = REPLY_FILTERS.includes(rawReply as ReplyState) ? (rawReply as ReplyState) : null;

  const [tickets, counts] = await Promise.all([
    prisma.ticket.findMany({
      where: { tenantId: tenant.id, ...VIEWS[view].where },
      include: {
        customer: true,
        channelRef: true,
        messages: { orderBy: { sentAt: "asc" }, select: { direction: true, sentAt: true, text: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.ticket.groupBy({ by: ["status"], where: { tenantId: tenant.id }, _count: true }),
  ]);
  const noiseCount = counts.find((c) => c.status === "archived")?._count ?? 0;
  const openCount = counts.filter((c) => !["archived", "resolved"].includes(c.status)).reduce((s, c) => s + c._count, 0);

  const noiseCats = new Set<string>(NOISE_CATEGORIES);
  let rows: Row[] = tickets.map((t) => {
    const firstInbound = t.messages.find((m) => m.direction === "inbound");
    const replyState = computeReplyState(t.messages);
    const category = t.tags.find((tag) => !tag.startsWith("product:")) ?? null;
    const open = !["archived", "resolved", "replied"].includes(t.status);
    return {
      id: t.id,
      name: t.customer.displayName ?? "Customer",
      subject: t.subject ?? "",
      snippet: firstInbound?.text.slice(0, 110) ?? "",
      status: t.status,
      category,
      wholesale: t.channelRef?.supportAddress?.startsWith("wholesale") ?? false,
      urgent: t.priority === "high" && open,
      replyState,
      looksNoise: category !== null && noiseCats.has(category),
    };
  });
  if (replyFilter) rows = rows.filter((r) => r.replyState === replyFilter);
  // Urgent open tickets pin to the top — they must be answered first.
  rows.sort((a, b) => Number(b.urgent) - Number(a.urgent));

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <div className="flex items-baseline gap-4">
          <h1 className="text-xl font-semibold tracking-tight">Inbox</h1>
          <nav className="flex gap-2 text-sm">
            {(["open", "noise", "all"] as ViewKey[]).map((k) => (
              <Link
                key={k}
                href={k === "open" ? "/" : `/?view=${k}`}
                className={`rounded-full px-3 py-1 ${
                  view === k ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-neutral-100"
                }`}
              >
                {VIEWS[k].label}
                {k === "open" ? ` ${openCount}` : k === "noise" ? ` ${noiseCount}` : ""}
              </Link>
            ))}
          </nav>
        </div>
        <span className="text-sm text-neutral-500">{rows.length} shown</span>
      </div>

      {/* reply-state filter — automatic rules, always current */}
      <div className="mb-3 flex items-center gap-2 text-xs">
        <Link
          href={view === "open" ? "/" : `/?view=${view}`}
          className={`rounded-full px-2.5 py-1 ${!replyFilter ? "bg-neutral-200 text-neutral-800" : "text-neutral-500 hover:bg-neutral-100"}`}
        >
          all
        </Link>
        {REPLY_FILTERS.map((f) => (
          <Link
            key={f}
            href={`/?${view === "open" ? "" : `view=${view}&`}reply=${f}`}
            className={`rounded-full px-2.5 py-1 ${replyFilter === f ? "bg-neutral-200 text-neutral-800" : "text-neutral-500 hover:bg-neutral-100"}`}
          >
            {REPLY_STATE_LABEL[f]}
          </Link>
        ))}
      </div>

      <InboxList rows={rows} view={view} />
    </div>
  );
}
