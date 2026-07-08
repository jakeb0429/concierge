import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { sessionUser } from "@/lib/roles";
import { redirect } from "next/navigation";
import TrainingQueue from "./TrainingQueue";

export const dynamic = "force-dynamic";

/**
 * A specialist's personal brain-training queue: open proposals routed to them
 * because the category matches their specialties. Approving folds the change
 * into the Brain (refinement over addition — same gate as the Brain manager).
 */
export default async function TrainingPage() {
  const me = await sessionUser();
  if (!me) redirect("/login");
  const tenant = await getCurrentTenant();

  const signals = await prisma.learningSignal.findMany({
    where: { tenantId: tenant.id, status: "open", assigneeId: me.id },
    orderBy: { createdAt: "desc" },
  });
  const itemIds = signals.map((s) => s.knowledgeItemId).filter((x): x is string => !!x);
  const items = itemIds.length
    ? await prisma.knowledgeItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, title: true, answer: true } })
    : [];
  const itemById = new Map(items.map((i) => [i.id, i]));

  return (
    <TrainingQueue
      signals={signals.map((s) => {
        const ev = (s.evidence as { title?: string; notes?: string[] } | null) ?? {};
        const item = s.knowledgeItemId ? itemById.get(s.knowledgeItemId) : undefined;
        return {
          id: s.id,
          kind: s.kind,
          target: s.proposedTarget,
          category: s.category,
          itemTitle: item?.title ?? ev.title ?? null,
          currentAnswer: item?.answer ?? null,
          proposedText: s.proposedText,
          occurrences: s.occurrences,
          repNote: ev.notes?.length ? ev.notes[ev.notes.length - 1] : null,
          createdAt: s.createdAt.toISOString(),
        };
      })}
    />
  );
}
