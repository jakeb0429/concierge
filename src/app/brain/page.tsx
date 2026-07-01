import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import BrainManager from "./BrainManager";

export const dynamic = "force-dynamic";

export default async function BrainPage() {
  const tenant = await getCurrentTenant();
  const [items, signals] = await Promise.all([
    prisma.knowledgeItem.findMany({
      where: { tenantId: tenant.id },
      orderBy: [{ category: "asc" }, { title: "asc" }],
    }),
    prisma.learningSignal.findMany({
      where: { tenantId: tenant.id, status: "open" },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const titleById = new Map(items.map((i) => [i.id, i.title]));

  return (
    <BrainManager
      initialSignals={signals.map((s) => ({
        id: s.id,
        kind: s.kind,
        target: s.proposedTarget,
        itemTitle: s.knowledgeItemId ? (titleById.get(s.knowledgeItemId) ?? null) : null,
        proposedText: s.proposedText,
        occurrences: s.occurrences,
      }))}
      initialItems={items.map((i) => ({
        id: i.id,
        title: i.title,
        answer: i.answer,
        category: i.category,
        kind: i.kind,
        status: i.status,
        version: i.version,
        timesCited: i.timesCited,
        sourceRef: i.sourceRef,
      }))}
    />
  );
}
