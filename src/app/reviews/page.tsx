import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import ReviewQueue from "./ReviewQueue";

export const dynamic = "force-dynamic";

/** Manager review queue — drafts reps submitted before sending. */
export default async function ReviewsPage() {
  const tenant = await getCurrentTenant();
  const pending = await prisma.draft.findMany({
    where: { tenantId: tenant.id, status: "pending_review" },
    orderBy: { createdAt: "asc" },
    include: { ticket: { include: { customer: true } } },
  });

  return (
    <div>
      <div className="mb-5 flex items-baseline justify-between">
        <h1 className="page-title">Review queue</h1>
        <span className="text-sm text-neutral-500">{pending.length} awaiting review</span>
      </div>
      {pending.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white px-4 py-10 text-center text-sm text-neutral-400">
          Nothing waiting. Reps submit drafts here with “Submit for review” on a ticket.
        </div>
      ) : (
        <ReviewQueue
          items={pending.map((d) => ({
            draftId: d.id,
            ticketId: d.ticketId,
            subject: d.ticket.subject ?? "(no subject)",
            customer: d.ticket.customer.displayName ?? d.ticket.customer.email ?? "Customer",
            body: d.editedBody ?? d.body,
            coverage: d.coverage,
            createdAt: d.createdAt.toISOString(),
          }))}
        />
      )}
      <p className="mt-4 text-xs text-neutral-400">
        Approved drafts unlock “Confirm and send” for the rep. Returned drafts go back with your note. <Link href="/" className="underline">Inbox</Link>
      </p>
    </div>
  );
}
