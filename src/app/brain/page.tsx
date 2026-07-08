import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import BrainManager from "./BrainManager";

export const dynamic = "force-dynamic";

export default async function BrainPage() {
  const tenant = await getCurrentTenant();
  const [items, signals, users] = await Promise.all([
    prisma.knowledgeItem.findMany({
      where: { tenantId: tenant.id },
      orderBy: [{ category: "asc" }, { title: "asc" }],
    }),
    prisma.learningSignal.findMany({
      where: { tenantId: tenant.id, status: "open" },
      orderBy: { createdAt: "desc" },
    }),
    prisma.user.findMany({ where: { tenantId: tenant.id }, select: { id: true, email: true, name: true } }),
  ]);
  const titleById = new Map(items.map((i) => [i.id, i.title]));
  const userById = new Map(users.map((u) => [u.id, u.name ?? u.email.split("@")[0]]));

  return (
    <BrainManager
      initialSignals={signals.map((s) => {
        const ev = (s.evidence as { title?: string; notes?: string[] } | null) ?? {};
        return {
          id: s.id,
          kind: s.kind,
          target: s.proposedTarget,
          itemTitle: s.knowledgeItemId ? (titleById.get(s.knowledgeItemId) ?? null) : (ev.title ?? null),
          proposedText: s.proposedText,
          occurrences: s.occurrences,
          repNote: ev.notes?.length ? ev.notes[ev.notes.length - 1] : null,
          category: s.category,
          assigneeName: s.assigneeId ? (userById.get(s.assigneeId) ?? null) : null,
        };
      })}
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
