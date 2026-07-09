import { PrismaClient } from "@prisma/client";
import { triage } from "../src/lib/triage";

/**
 * One-off: triage real Gmail tickets imported before triage existed.
 * Only touches status "new" (untouched by a rep) with no tags yet.
 */
// idempotent: selects only untagged status-"new" tickets; the triage stamp writes
// tags, which removes the ticket from the next run's work set.
const prisma = new PrismaClient();

async function main() {
  const rheos = await prisma.tenant.findUniqueOrThrow({ where: { slug: "rheos" } });
  const tickets = await prisma.ticket.findMany({
    where: {
      tenantId: rheos.id,
      channel: "gmail",
      status: "new",
      // The tags stamp below is the watermark — without this filter a re-run
      // would re-triage (and possibly re-archive) every still-new ticket.
      tags: { isEmpty: true },
      NOT: { providerThreadId: { startsWith: "mock-" } },
    },
    include: {
      customer: true,
      messages: { where: { direction: "inbound" }, orderBy: { sentAt: "asc" }, take: 1 },
    },
  });

  for (const t of tickets) {
    const res = await triage(t.customer.email ?? "", t.subject, t.messages[0]?.text ?? "");
    await prisma.ticket.update({
      where: { id: t.id },
      data: { status: res.isNoise ? "archived" : "new", priority: res.priority, tags: [res.category] },
    });
    console.log(`  ${res.isNoise ? "ARCHIVE" : "KEEP  "} [${res.category}${res.priority === "high" ? ", high" : ""}] ${t.customer.email} — ${(t.subject ?? "").slice(0, 55)}`);
  }
  console.log(`Re-triaged ${tickets.length} tickets.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
