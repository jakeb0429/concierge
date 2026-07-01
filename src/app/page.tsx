import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { statusChip, statusLabel } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function Inbox() {
  const tenant = await getCurrentTenant();
  const tickets = await prisma.ticket.findMany({
    where: { tenantId: tenant.id },
    include: {
      customer: true,
      messages: { where: { direction: "inbound" }, orderBy: { sentAt: "asc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <div className="mb-5 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Inbox</h1>
        <span className="text-sm text-neutral-500">{tickets.length} conversations</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
        {tickets.map((t) => {
          const snippet = t.messages[0]?.text.slice(0, 110) ?? "";
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
          <div className="px-4 py-10 text-center text-sm text-neutral-400">No conversations yet.</div>
        )}
      </div>
    </div>
  );
}
