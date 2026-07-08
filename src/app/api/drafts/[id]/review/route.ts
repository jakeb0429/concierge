import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { sessionUser, isAdminRole } from "@/lib/roles";

/**
 * Manager-review workflow on a draft:
 *   submit  (rep)     -> pending_review (send disabled until reviewed)
 *   approve (manager) -> approved (rep sees the green light and sends)
 *   return  (manager) -> back to prepared with a note for the rep
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await getCurrentTenant();
  const { action, note } = (await req.json()) as { action: "submit" | "approve" | "return"; note?: string };

  // Anyone can SUBMIT for review; only a lead or admin can approve/return.
  const actor = await sessionUser();
  const isReviewer = isAdminRole(actor?.role) || actor?.role === "team_lead";
  if (action !== "submit" && !isReviewer)
    return NextResponse.json({ error: "Only a team lead or admin can review drafts." }, { status: 403 });

  const draft = await prisma.draft.findFirst({ where: { id, tenantId: tenant.id } });
  if (!draft || draft.status === "sent") return NextResponse.json({ error: "Draft not reviewable." }, { status: 404 });

  const next =
    action === "submit" ? { status: "pending_review", reviewNote: null }
    : action === "approve" ? { status: "approved", reviewNote: null }
    : { status: "prepared", reviewNote: note ?? "Returned for changes." };

  await prisma.draft.update({ where: { id }, data: next });
  await prisma.auditEvent.create({
    data: { tenantId: tenant.id, actorId: actor?.id, action: `review_${action}`, entity: `draft:${id}`, meta: { note: note ?? null } },
  });
  return NextResponse.json({ ok: true, status: next.status, reviewNote: next.reviewNote });
}
