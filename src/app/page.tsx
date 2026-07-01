import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { statusChip, statusLabel } from "@/lib/ui";

export const dynamic = "force-dynamic";

import type { Prisma } from "@prisma/client";

const VIEWS: Record<string, { label: string; where: Prisma.TicketWhereInput }> = {
  open: { label: "Open", where: { status: { notIn: ["archived", "resolved"] } } },
  noise: { label: "Noise", where: { status: "archived" } },
  all: { label: "All", where: {} },
};
type ViewKey = "open" | "noise" | "all";

export default async function Inbox({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const tenant = await getCurrentTenant();
  const { view: rawView } = await searchParams;
  const view: ViewKey = rawView === "noise" || rawView === "all" ? rawView : "open";

  const [tickets, counts] = await Promise.all([
    prisma.ticket.findMany({
      where: { tenantId: tenant.id, ...VIEWS[view].where },
      include: {
        customer: true,
        channelRef: true,
        messages: { where: { direction: "inbound" }, orderBy: { sentAt: "asc" }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.ticket.groupBy({ by: ["status"], where: { tenantId: tenant.id }, _count: true }),
  ]);
  const noiseCount = counts.find((c) => c.status === "archived")?._count ?? 0;
  const openCount = counts.filter((c) => !["archived", "resolved"].includes(c.status)).reduce((s, c) => s + c._count, 0);

  return (
    <div>
      <div className="mb-5 flex items-baseline justify-between">
        <div className="flex items-baseline gap-4">
          <h1 className="text-xl font-semibold tracking-tight">Inbox</h1>
          <nav className="flex gap-2 text-sm">
            {(["open","noise","all"] as ViewKey[]).map((k) => (
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
        <span className="text-sm text-neutral-500">{tickets.length} shown</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
        {tickets.map((t) => {
          const snippet = t.messages[0]?.text.slice(0, 110) ?? "";
          const category = t.tags[0]?.replace(/_/g, " ");
          return (
            <Link
              key={t.id}
              href={`/tickets/${t.id}`}
              className="flex items-center gap-4 border-b border-neutral-100 px-4 py-3 last:border-0 hover:bg-neutral-50"
            >
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-medium text-blue-700">
                {(t.customer.displayName ?? "?")
                  .split(" ")
                  .map((s) => s[0])
                  .slice(0, 2)
                  .join("")}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{t.customer.displayName}</span>
                  {t.priority === "high" && (
                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] text-red-700">high</span>
                  )}
                  {t.channelRef?.supportAddress?.startsWith("wholesale") && (
                    <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[11px] text-purple-700">wholesale</span>
                  )}
                  {category && (
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500">
                      {category}
                    </span>
                  )}
                </div>
                <div className="truncate text-sm text-neutral-700">{t.subject}</div>
                <div className="truncate text-xs text-neutral-400">{snippet}</div>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-[11px] ${statusChip(t.status)}`}>
                {statusLabel(t.status)}
              </span>
            </Link>
          );
        })}
        {tickets.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-neutral-400">Nothing here.</div>
        )}
      </div>
    </div>
  );
}
