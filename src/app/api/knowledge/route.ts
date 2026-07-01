import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";

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
  return NextResponse.json({ item });
}
