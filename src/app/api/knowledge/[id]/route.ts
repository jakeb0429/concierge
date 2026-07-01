import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await getCurrentTenant();
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
  return NextResponse.json({ item });
}
