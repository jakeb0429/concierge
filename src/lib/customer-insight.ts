import { after } from "next/server";
import { prisma } from "./db";
import { anthropic } from "./anthropic";
import { cleanEmailText } from "./email-clean";

/**
 * The AI customer read — a 2–3 sentence interpretation of everything the
 * platform knows about a customer (D2C + B2B order history, inquiry pattern,
 * purchase-channel facts, recent messages), cached on the Customer row.
 *
 * NEVER blocks a page: the staleness check is three cheap aggregates; when
 * the basis changed, the CACHED read is returned immediately and the
 * regeneration runs after the response (next/server `after`). A rep's first
 * view of brand-new activity may show the prior read for one page load —
 * that beats 2–6s of model latency on the page reps live in.
 */

const INSIGHT_MODEL = "claude-sonnet-5";

const INSIGHT_TOOL = {
  name: "customer_read",
  description: "The support-facing read on this customer.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: {
        type: "string",
        description:
          "2-3 short sentences a rep reads before replying. Strictly from the facts given — no invention.",
      },
    },
    required: ["summary"],
  },
};

type Basis = { orders: number; tickets: number; inquiries: number; channel: string };

export async function getCustomerInsight(customerId: string): Promise<string | null> {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return null;
  const email = customer.email?.toLowerCase();
  if (!email) return customer.insight ?? null;

  // Staleness check = aggregates only, no row data.
  const [orderCount, inquiryCats, ticketCount] = await Promise.all([
    prisma.customerOrder.count({ where: { email, tenantId: customer.tenantId } }),
    prisma.analyticsInquiry.groupBy({
      by: ["category"],
      where: { fromEmail: email, tenantId: customer.tenantId },
      _count: true,
    }),
    prisma.ticket.count({ where: { customerId } }),
  ]);
  const basis: Basis = {
    orders: orderCount,
    tickets: ticketCount,
    inquiries: inquiryCats.reduce((s, c) => s + c._count, 0),
    channel: `${customer.purchaseChannel ?? ""}|${customer.channelName ?? ""}`,
  };
  // Field-by-field — jsonb does NOT preserve key order, so comparing
  // serializations never matches and would regenerate on every view.
  const prev = customer.insightBasis as Basis | null;
  const fresh =
    !!prev &&
    prev.orders === basis.orders &&
    prev.tickets === basis.tickets &&
    prev.inquiries === basis.inquiries &&
    prev.channel === basis.channel;
  if (customer.insight && fresh) return customer.insight;

  // Nothing knowable yet — don't burn a model call to say so.
  if (basis.orders === 0 && basis.inquiries === 0 && basis.tickets === 0 && !customer.purchaseChannel)
    return null;

  // Stale: serve what we have, regenerate out-of-band.
  after(() =>
    regenerateInsight(customerId, basis).catch((e) => console.error("[customer-insight] refresh failed:", e))
  );
  return customer.insight ?? null;
}

/** The expensive path — full history fetch + model call + cache write. */
async function regenerateInsight(customerId: string, basis: Basis): Promise<void> {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  const email = customer?.email?.toLowerCase();
  if (!customer || !email) return;

  const [orders, inquiryCats, recentMsgs] = await Promise.all([
    prisma.customerOrder.findMany({
      where: { email, tenantId: customer.tenantId },
      orderBy: { orderedAt: "desc" },
      take: 500, // a wholesale account can be huge; 500 newest is plenty of signal
      select: { source: true, totalAmount: true, orderedAt: true, refunded: true },
    }),
    prisma.analyticsInquiry.groupBy({ by: ["category"], where: { fromEmail: email, tenantId: customer.tenantId }, _count: true }),
    prisma.message.findMany({
      where: { ticket: { customerId }, direction: "inbound" },
      orderBy: { sentAt: "desc" },
      take: 3,
      select: { text: true, sentAt: true },
    }),
  ]);

  const bySource = new Map<string, { n: number; total: number }>();
  for (const o of orders) {
    const s = bySource.get(o.source) ?? { n: 0, total: 0 };
    s.n++;
    s.total += Number(o.totalAmount);
    bySource.set(o.source, s);
  }
  const refunds = orders.filter((o) => o.refunded).length;
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const facts = [
    `Customer: ${customer.displayName ?? email}`,
    ...(orders.length
      ? [
          `Orders: ${[...bySource.entries()]
            .map(([src, s]) => `${s.n} via ${src === "hubspot-b2b" ? "wholesale/B2B" : src} ($${Math.round(s.total)})`)
            .join(", ")}; first ${fmt(orders.at(-1)!.orderedAt)}, latest ${fmt(orders[0].orderedAt)}; ${refunds} refunded`,
        ]
      : ["Orders: none on record under this email (they may buy via a retailer, dealer, Amazon, or another email)"]),
    ...(inquiryCats.length
      ? [`Support history (12mo): ${inquiryCats.map((c) => `${c.category}×${c._count}`).join(", ")}; ${basis.tickets} tickets in Concierge`]
      : []),
    ...(customer.purchaseChannel
      ? [`Known purchase channel (rep-entered): ${customer.purchaseChannel}${customer.channelName ? ` — ${customer.channelName}` : ""}`]
      : []),
    ...recentMsgs.map((m) => `Recent message (${fmt(m.sentAt)}): ${cleanEmailText(m.text).slice(0, 280)}`),
  ].join("\n");

  const res = await anthropic.messages.create({
    model: INSIGHT_MODEL,
    max_tokens: 512,
    thinking: { type: "disabled" }, // forced tool choice + small budget
    tools: [INSIGHT_TOOL],
    tool_choice: { type: "tool", name: "customer_read" },
    system:
      "Write the short read a support rep needs before replying to this customer. Only what the facts " +
      "support: their buying relationship (direct consumer vs wholesale/B2B partner, spend, tenure), " +
      "whether their warranty/return contact rate is notable against their order count, any signal they " +
      "buy for someone else or bought through a retailer/dealer (say so if the messages imply it), and " +
      "anything a rep should handle carefully. Plain, specific, no fluff, no repetition of raw numbers " +
      "the rep already sees in the stats strip — interpret, don't recite.",
    messages: [{ role: "user", content: facts }],
  });
  const call = res.content.find((c) => c.type === "tool_use");
  if (!call || call.type !== "tool_use") return;
  const summary = (call.input as { summary: string }).summary.trim();
  await prisma.customer.update({
    where: { id: customerId },
    data: { insight: summary, insightAt: new Date(), insightBasis: basis },
  });
}
