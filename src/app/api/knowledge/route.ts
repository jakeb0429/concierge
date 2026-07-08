import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { sessionUser, isAdminRole } from "@/lib/roles";
import { reindexKnowledgeItem } from "@/lib/brain/index-write";

export async function GET() {
  const tenant = await getCurrentTenant();
  const items = await prisma.knowledgeItem.findMany({
    where: { tenantId: tenant.id },
    orderBy: [{ category: "asc" }, { title: "asc" }],
  });
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const tenant = await getCurrentTenant();
  // Direct Brain writes are lead/admin territory — agents refine the Brain
  // through their training queue (signals), which is human-gated by design.
  const actor = await sessionUser();
  if (!isAdminRole(actor?.role) && actor?.role !== "team_lead")
    return NextResponse.json({ error: "Only a team lead or admin can edit the Brain directly." }, { status: 403 });

  const b = (await req.json()) as {
    title: string;
    answer: string;
    category?: string;
    kind?: string;
    triggerPhrases?: string;
  };
  const item = await prisma.knowledgeItem.create({
    data: {
      tenantId: tenant.id,
      kind: b.kind ?? "faq",
      title: b.title,
      answer: b.answer,
      category: b.category || null,
      triggerPhrases: (b.triggerPhrases ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      status: "approved",
      sourceRef: "authored in manager",
    },
  });
  await prisma.auditEvent.create({
    data: { tenantId: tenant.id, action: "answer_promoted", entity: `knowledge:${item.id}` },
  });
  await reindexKnowledgeItem(item.id, item.title, item.answer);
  return NextResponse.json({ item });
}
