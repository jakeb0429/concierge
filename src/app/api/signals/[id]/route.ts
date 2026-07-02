import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { reindexKnowledgeItem } from "@/lib/brain/index-write";

/**
 * Resolve a learning signal. Approval is the ONLY path from Ledger to Brain:
 *   answer      -> revise the KnowledgeItem's canonical answer (version bump)
 *   voice_guide -> append the rule to the tenant's voice guide
 *   avoid_note  -> add to the item's avoidNotes
 *   new_entry   -> create a new approved KnowledgeItem (rep-taught learning)
 * Body: { action: "approve" | "dismiss" }
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await getCurrentTenant();
  const { action } = (await req.json()) as { action: "approve" | "dismiss" };

  const signal = await prisma.learningSignal.findFirst({
    where: { id, tenantId: tenant.id, status: "open" },
  });
  if (!signal) return NextResponse.json({ error: "Signal not found or already resolved." }, { status: 404 });

  if (action === "approve" && signal.proposedText) {
    if (signal.proposedTarget === "answer" && signal.knowledgeItemId) {
      const item = await prisma.knowledgeItem.findUnique({ where: { id: signal.knowledgeItemId } });
      if (item) {
        await prisma.knowledgeItem.update({
          where: { id: item.id },
          data: { answer: signal.proposedText, version: item.version + 1 },
        });
        await reindexKnowledgeItem(item.id, item.title, signal.proposedText);
      }
    } else if (signal.proposedTarget === "voice_guide") {
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: { voiceGuide: `${tenant.voiceGuide ?? ""}\n\n${signal.proposedText}`.trim() },
      });
    } else if (signal.proposedTarget === "avoid_note" && signal.knowledgeItemId) {
      await prisma.knowledgeItem.update({
        where: { id: signal.knowledgeItemId },
        data: { avoidNotes: { push: signal.proposedText } },
      });
    } else if (signal.proposedTarget === "new_entry") {
      const ev = (signal.evidence as { title?: string; category?: string; ticketId?: string } | null) ?? {};
      const item = await prisma.knowledgeItem.create({
        data: {
          tenantId: tenant.id,
          kind: "faq",
          title: ev.title ?? "Learning from a live ticket",
          answer: signal.proposedText,
          category: ev.category ?? null,
          status: "approved",
          sourceRef: ev.ticketId ? `taught on ticket:${ev.ticketId}` : "taught from a ticket",
        },
      });
      await reindexKnowledgeItem(item.id, item.title, item.answer);
    }
  }

  const updated = await prisma.learningSignal.update({
    where: { id: signal.id },
    data: { status: action === "approve" ? "approved" : "dismissed", resolvedAt: new Date() },
  });
  await prisma.auditEvent.create({
    data: {
      tenantId: tenant.id,
      action: action === "approve" ? "signal_approved" : "signal_dismissed",
      entity: `signal:${signal.id}`,
      meta: { kind: signal.kind, knowledgeItemId: signal.knowledgeItemId },
    },
  });
  return NextResponse.json({ signal: updated });
}
