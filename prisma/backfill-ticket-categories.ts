import { PrismaClient } from "@prisma/client";
import { triage, brandContextFor } from "../src/lib/triage";
import { autoAssign } from "../src/lib/assign";

/**
 * One-time backfill: classify existing tickets that predate Ticket.category
 * into the fine-grained taxonomy, and auto-assign the unassigned open ones to
 * specialists. Idempotent — only touches rows with category null.
 *
 * Usage: tsx prisma/backfill-ticket-categories.ts [maxRows=200]
 */

// idempotent: selects only rows with category IS NULL — stamping the category removes
// a ticket from the next run's work set; assignment only fills empty assigneeId.

const prisma = new PrismaClient();
const MAX = Number(process.argv[2] ?? 200);

async function main() {
  const tickets = await prisma.ticket.findMany({
    where: { category: null, status: { not: "archived" } },
    include: {
      tenant: { select: { slug: true } },
      customer: { select: { email: true } },
      messages: { where: { direction: "inbound" }, orderBy: { sentAt: "asc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
    take: MAX,
  });
  console.log(`${tickets.length} tickets need a category.`);

  let assigned = 0;
  for (const t of tickets) {
    const first = t.messages[0];
    const res = await triage(
      t.customer.email ?? "",
      t.subject,
      first?.text ?? "",
      brandContextFor(t.tenant.slug)
    );
    // Existing tickets keep their status/priority — this pass only categorizes.
    await prisma.ticket.update({ where: { id: t.id }, data: { category: res.inquiryCategory } });
    const open = !["archived", "resolved", "replied"].includes(t.status);
    if (open && !t.assigneeId) {
      const a = await autoAssign(t.tenantId, t.id, res.inquiryCategory);
      if (a) assigned++;
    }
    console.log(`  ${t.subject?.slice(0, 60) ?? "(no subject)"} → ${res.inquiryCategory}`);
  }
  console.log(`Done. ${tickets.length} categorized, ${assigned} auto-assigned.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
