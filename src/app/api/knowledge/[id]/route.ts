import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { sessionUser, isAdminRole } from "@/lib/roles";
import { reindexKnowledgeItem } from "@/lib/brain/index-write";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await getCurrentTenant();
  // Direct Brain writes are lead/admin territory — agents refine the Brain
  // through their training queue (signals), which is human-gated by design.
  const actor = await sessionUser();
  if (!isAdminRole(actor?.role) && actor?.role !== "team_lead")
    return NextResponse.json({ error: "Only a team lead or admin can edit the Brain directly." }, { status: 403 });

  const b = (await req.json()) as { title?: string; answer?: string; status?: string };

  const existing = await prisma.knowledgeItem.findFirstOrThrow({
    where: { id, tenantId: tenant.id },
  });
  const item = await prisma.knowledgeItem.update({
    where: { id },
    data: {
      title: b.title ?? existing.title,
      answer: b.answer ?? existing.answer,
      status: b.status ?? existing.status,
      // Editing the canonical answer bumps the version — one entry, improved in place.
      version: b.answer && b.answer !== existing.answer ? existing.version + 1 : existing.version,
    },
  });
  if (b.answer && b.answer !== existing.answer) await reindexKnowledgeItem(item.id, item.title, item.answer);
  return NextResponse.json({ item });
}
