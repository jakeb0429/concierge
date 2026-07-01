import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import BrainManager from "./BrainManager";

export const dynamic = "force-dynamic";

export default async function BrainPage() {
  const tenant = await getCurrentTenant();
  const items = await prisma.knowledgeItem.findMany({
    where: { tenantId: tenant.id },
    orderBy: [{ category: "asc" }, { title: "asc" }],
  });

  return (
    <BrainManager
      initialItems={items.map((i) => ({
        id: i.id,
        title: i.title,
        answer: i.answer,
        category: i.category,
        kind: i.kind,
        status: i.status,
        version: i.version,
        timesCited: i.timesCited,
      }))}
    />
  );
}
