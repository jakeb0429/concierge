import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { sessionUser, isAdminRole } from "@/lib/roles";
import SourcesPanel from "./SourcesPanel";

export const dynamic = "force-dynamic";

/**
 * Sales-data intake, per brand. Config rows live in SalesSource (secrets stay
 * in env); the numbers shown are derived live from CustomerOrder so they're
 * honest regardless of when a sync script last stamped its stats.
 */
export default async function SourcesPage() {
  const me = await sessionUser();
  if (!me || !isAdminRole(me.role)) redirect("/");
  const tenant = await getCurrentTenant();

  const [sources, derived] = await Promise.all([
    prisma.salesSource.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: "asc" } }),
    prisma.customerOrder.groupBy({
      by: ["source"],
      where: { tenantId: tenant.id },
      _count: true,
      _sum: { totalAmount: true },
      _max: { orderedAt: true },
    }),
  ]);
  const bySource = new Map(derived.map((d) => [d.source, d]));

  return (
    <SourcesPanel
      tenantName={tenant.name}
      sources={sources.map((s) => {
        const d = bySource.get(s.key);
        return {
          id: s.id,
          key: s.key,
          label: s.label,
          kind: s.kind,
          channelType: s.channelType,
          notes: s.notes,
          active: s.active,
          lastSyncAt: s.lastSyncAt?.toISOString() ?? null,
          orders: d?._count ?? 0,
          revenue: Number(d?._sum.totalAmount ?? 0),
          latestOrder: d?._max.orderedAt?.toISOString() ?? null,
        };
      })}
    />
  );
}
