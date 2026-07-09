import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { sessionUser, isAdminRole } from "@/lib/roles";
import { reindexKnowledgeItem } from "@/lib/brain/index-write";
import { parseBody } from "@/lib/validate";

const bodySchema = z.object({
  title: z.string().min(1).optional(),
  answer: z.string().min(1).optional(),
  status: z.enum(["draft", "approved"]).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await getCurrentTenant();
  // Direct Brain writes are lead/admin territory — agents refine the Brain
  // through their training queue (signals), which is human-gated by design.
  const actor = await sessionUser();
  if (!isAdminRole(actor?.role) && actor?.role !== "team_lead")
    return NextResponse.json({ error: "Only a team lead or admin can edit the Brain directly." }, { status: 403 });

  const b = await parseBody(req, bodySchema);
  if (b instanceof NextResponse) return b;

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
