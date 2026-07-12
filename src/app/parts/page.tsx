import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { sessionUser } from "@/lib/roles";
import PartsManager from "./PartsManager";

export const dynamic = "force-dynamic";

export default async function PartsPage() {
  const me = await sessionUser();
  if (!me) redirect("/");
  const tenant = await getCurrentTenant();

  const arms = await prisma.armInventory.findMany({
    where: { tenantId: tenant.id },
    orderBy: [{ brand: "asc" }, { sku: "asc" }],
    select: { id: true, sku: true, brand: true, container: true, leftCount: true, rightCount: true },
  });

  return <PartsManager initialArms={arms} />;
}
