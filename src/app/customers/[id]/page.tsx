import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { statusChip, statusLabel } from "@/lib/ui";
import { getCustomerInsight } from "@/lib/customer-insight";
import CustomerFacts from "./CustomerFacts";
import NotesPanel from "@/app/components/NotesPanel";

export const dynamic = "force-dynamic";

const SENTIMENT_CHIP: Record<string, string> = {
  positive: "bg-green-50 text-green-700",
  neutral: "bg-neutral-100 text-neutral-600",
  unresolved: "bg-amber-50 text-amber-700",
  negative: "bg-red-50 text-red-700",
};

const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default async function CustomerProfile({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer) notFound();
  const email = customer.email?.toLowerCase();

  const [orders, inquiries, tickets] = await Promise.all([
    email
      ? prisma.customerOrder.findMany({ where: { email }, orderBy: { orderedAt: "desc" } })
      : Promise.resolve([]),
    email
      ? prisma.analyticsInquiry.findMany({ where: { fromEmail: email }, orderBy: { threadCreatedAt: "desc" } })
      : Promise.resolve([]),
    prisma.ticket.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: "desc" },
      include: { messages: { where: { direction: "inbound" }, take: 1, orderBy: { sentAt: "asc" } } },
    }),
  ]);

  const ltv = orders.reduce((s, o) => s + Number(o.totalAmount), 0);
  const firstOrder = orders.at(-1);
  const lastOrder = orders[0];
  const negatives = inquiries.filter((q) => q.endSentiment === "negative").length;
  const insight = await getCustomerInsight(customer.id).catch(() => null);
  const now = Date.now();
  const notes = (
    await prisma.contextNote.findMany({
      where: { tenantId: customer.tenantId, customerId: customer.id },
      orderBy: { createdAt: "desc" },
    })
  ).map((n) => ({
    id: n.id,
    body: n.body,
    scope: "customer" as const,
    expiresAt: n.expiresAt?.toISOString() ?? null,
    expired: !!n.expiresAt && n.expiresAt.getTime() < now,
  }));

  return (
    <div>
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">← Inbox</Link>

      <div className="mt-3 flex items-center gap-4 rounded-xl border border-neutral-200 bg-white px-5 py-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-sm font-medium text-blue-700">
          {(customer.displayName ?? "?").split(" ").map((s) => s[0]).slice(0, 2).join("")}
        </div>
        <div className="min-w-0">
          <div className="text-lg font-semibold">{customer.displayName ?? "Unknown customer"}</div>
          <div className="text-sm text-neutral-500">{customer.email}</div>
        </div>
        {negatives > 0 && (
          <span className="ml-auto rounded-full bg-red-50 px-3 py-1 text-xs text-red-700">
            {negatives} negative outcome{negatives > 1 ? "s" : ""} — handle with care
          </span>
        )}
      </div>

      <CustomerFacts
        customerId={customer.id}
        purchaseChannel={customer.purchaseChannel}
        channelName={customer.channelName}
        insight={insight}
      />

      <div className="mt-3">
        <NotesPanel notes={notes} customerId={customer.id} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="text-xs text-neutral-400">Lifetime orders</div>
          <div className="text-2xl font-semibold">{orders.length}</div>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="text-xs text-neutral-400">Lifetime value</div>
          <div className="text-2xl font-semibold">{money(ltv)}</div>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="text-xs text-neutral-400">Customer since</div>
          <div className="text-2xl font-semibold">{firstOrder ? fmtDate(firstOrder.orderedAt) : "—"}</div>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="text-xs text-neutral-400">Support contacts</div>
          <div className="text-2xl font-semibold">{inquiries.length + tickets.length}</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {/* Orders */}
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="mb-2 text-sm font-medium">Order history</div>
          {orders.length ? (
            <div className="divide-y divide-neutral-100">
              {orders.map((o) => (
                <div key={o.id} className="flex items-baseline justify-between py-2 text-sm">
                  <span className="text-neutral-700">#{o.orderRef}</span>
                  <span className="text-xs text-neutral-400">{fmtDate(o.orderedAt)}</span>
                  <span className="font-medium">{money(Number(o.totalAmount))}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-neutral-400">
              No matched orders{lastOrder ? "" : " (order matching covers the Shopify warehouse through Aug 2025 + Amazon)"}
            </p>
          )}
        </div>

        {/* Support history */}
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="mb-2 text-sm font-medium">Support history</div>
          <div className="space-y-2">
            {tickets.map((t) => (
              <Link key={t.id} href={`/tickets/${t.id}`} className="block rounded-lg border border-neutral-100 px-3 py-2 hover:bg-neutral-50">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm text-neutral-800">{t.subject ?? "(no subject)"}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${statusChip(t.status)}`}>{statusLabel(t.status)}</span>
                </div>
                <div className="mt-0.5 text-xs text-neutral-400">{fmtDate(t.createdAt)} · Concierge ticket</div>
              </Link>
            ))}
            {inquiries.map((q) => (
              <div key={q.id} className="rounded-lg border border-neutral-100 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm text-neutral-800">{q.category.replace(/_/g, " ")}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${SENTIMENT_CHIP[q.endSentiment] ?? ""}`}>{q.endSentiment}</span>
                </div>
                <div className="mt-0.5 text-xs text-neutral-400">
                  {fmtDate(q.threadCreatedAt)} · email history
                  {q.daysSincePurchase != null ? ` · ${q.daysSincePurchase}d after purchase` : ""}
                </div>
              </div>
            ))}
            {tickets.length + inquiries.length === 0 && (
              <p className="text-sm text-neutral-400">No support history.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
