import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { sessionUser, isAdminRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/** Human phrasing for the ledger — falls back to the raw action name. */
const ACTION_LABEL: Record<string, string> = {
  draft_generated: "draft generated",
  draft_regenerated: "draft regenerated",
  draft_edited: "draft edited by rep",
  reply_sent: "reply sent",
  ticket_replied_external: "answered in Gmail",
  ticket_reopened: "ticket reopened (customer wrote back)",
  ticket_resolved: "ticket resolved",
  ticket_archived: "ticket archived",
  ticket_reassigned: "ticket reassigned",
  ticket_recategorized: "ticket recategorized",
  auto_assigned: "auto-assigned to specialist",
  provider_archived: "archived in the mailbox",
  signal_approved: "training approved → Brain updated",
  signal_dismissed: "training dismissed",
  correction_submitted: "rep correction submitted",
  learning_submitted: "rep learning submitted",
  answer_promoted: "answer promoted to Brain",
  review_submit: "submitted for manager review",
  review_approve: "manager approved draft",
  review_return: "draft returned for changes",
  user_provisioned: "teammate added",
  user_updated: "teammate updated",
  password_set: "password set",
  customer_channel_updated: "purchase channel updated",
  note_added: "context note added",
  note_updated: "context note updated",
  note_removed: "context note removed",
  sales_source_updated: "sales source updated",
};

function entityHref(entity: string): string | null {
  if (entity.startsWith("ticket:")) return `/tickets/${entity.slice(7)}`;
  if (entity.startsWith("customer:")) return `/customers/${entity.slice(9)}`;
  return null;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; page?: string }>;
}) {
  const me = await sessionUser();
  if (!me || !isAdminRole(me.role)) redirect("/");
  const tenant = await getCurrentTenant();
  const { action, page: rawPage } = await searchParams;
  const page = Math.max(1, Number(rawPage) || 1);
  const where = { tenantId: tenant.id, ...(action ? { action } : {}) };

  const [events, total, actionCounts, users] = await Promise.all([
    prisma.auditEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.auditEvent.count({ where }),
    prisma.auditEvent.groupBy({ by: ["action"], where: { tenantId: tenant.id }, _count: true }),
    prisma.user.findMany({ where: { tenantId: tenant.id }, select: { id: true, name: true, email: true } }),
  ]);
  const actorLabel = new Map(users.map((u) => [u.id, u.name ?? u.email.split("@")[0]]));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const fmt = (d: Date) =>
    d.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="page-title">Audit trail — {tenant.name}</h1>
        <span className="text-sm text-neutral-500">
          {total.toLocaleString()} event{total === 1 ? "" : "s"}
          {action ? ` · ${ACTION_LABEL[action] ?? action}` : ""}
        </span>
      </div>

      {/* action filter */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
        <Link
          href="/audit"
          className={`rounded-full px-2.5 py-1 ${!action ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"}`}
        >
          All
        </Link>
        {actionCounts
          .sort((a, b) => b._count - a._count)
          .slice(0, 14)
          .map((a) => (
            <Link
              key={a.action}
              href={`/audit?action=${encodeURIComponent(a.action)}`}
              className={`rounded-full px-2.5 py-1 ${action === a.action ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"}`}
            >
              {ACTION_LABEL[a.action] ?? a.action} ({a._count})
            </Link>
          ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
        {events.map((e) => {
          const href = entityHref(e.entity);
          const meta = e.meta as Record<string, unknown> | null;
          const metaBits = meta
            ? Object.entries(meta)
                .filter(([, v]) => v !== null && typeof v !== "object")
                .slice(0, 4)
                .map(([k, v]) => `${k}: ${String(v).slice(0, 60)}`)
                .join(" · ")
            : "";
          return (
            <div key={e.id} className="flex items-baseline gap-3 border-b border-neutral-100 px-4 py-2 text-xs last:border-0">
              <span className="w-32 flex-shrink-0 text-neutral-400">{fmt(e.createdAt)}</span>
              <span className="w-28 flex-shrink-0 text-neutral-500">
                {e.actorId ? (actorLabel.get(e.actorId) ?? "removed user") : "system"}
              </span>
              <span className="font-medium text-neutral-800">{ACTION_LABEL[e.action] ?? e.action}</span>
              {href ? (
                <Link href={href} className="text-blue-600 hover:underline">
                  {e.entity.split(":")[0]} →
                </Link>
              ) : (
                <span className="text-neutral-400">{e.entity.split(":")[0]}</span>
              )}
              {metaBits && <span className="min-w-0 truncate text-neutral-400">{metaBits}</span>}
            </div>
          );
        })}
        {events.length === 0 && <div className="px-4 py-10 text-center text-sm text-neutral-400">No events.</div>}
      </div>

      {pages > 1 && (
        <div className="mt-3 flex items-center gap-2 text-xs">
          {page > 1 && (
            <Link href={`/audit?${action ? `action=${encodeURIComponent(action)}&` : ""}page=${page - 1}`} className="rounded-lg border border-neutral-200 px-3 py-1 hover:bg-neutral-50">
              ← Newer
            </Link>
          )}
          <span className="text-neutral-400">page {page} of {pages}</span>
          {page < pages && (
            <Link href={`/audit?${action ? `action=${encodeURIComponent(action)}&` : ""}page=${page + 1}`} className="rounded-lg border border-neutral-200 px-3 py-1 hover:bg-neutral-50">
              Older →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
