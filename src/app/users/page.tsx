import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { sessionUser, isAdminRole } from "@/lib/roles";
import { INACTIVE_STATUSES } from "@/lib/ticket-status";
import UsersManager from "./UsersManager";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const me = await sessionUser();
  if (!me || !isAdminRole(me.role)) redirect("/");
  const tenant = await getCurrentTenant();

  const [users, openCounts, signalCounts] = await Promise.all([
    prisma.user.findMany({
      where: { tenantId: tenant.id },
      orderBy: [{ role: "asc" }, { email: "asc" }],
    }),
    prisma.ticket.groupBy({
      by: ["assigneeId"],
      where: { tenantId: tenant.id, assigneeId: { not: null }, status: { notIn: INACTIVE_STATUSES } },
      _count: true,
    }),
    prisma.learningSignal.groupBy({
      by: ["assigneeId"],
      where: { tenantId: tenant.id, assigneeId: { not: null }, status: "open" },
      _count: true,
    }),
  ]);
  const openBy = new Map(openCounts.map((c) => [c.assigneeId, c._count]));
  const signalsBy = new Map(signalCounts.map((c) => [c.assigneeId, c._count]));

  return (
    <UsersManager
      tenantName={tenant.name}
      meId={me.id}
      initialUsers={users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        specialties: u.specialties,
        preferredView: u.preferredView,
        lastLogin: u.lastLogin?.toISOString() ?? null,
        openTickets: openBy.get(u.id) ?? 0,
        openSignals: signalsBy.get(u.id) ?? 0,
      }))}
    />
  );
}
