import { PrismaClient } from "@prisma/client";

/**
 * Live Shopify order import — the complete D2C history, via the Dev Dashboard
 * app's client-credentials grant (tokens are minted on demand and expire in
 * 24h; nothing static to rotate ever again).
 *
 *   - CustomerOrder: every order with an email (powers customer profiles +
 *     time-since-purchase). Replaces the stale warehouse rows.
 *   - SalesMonthly(source=shopify-live): monthly totals over ALL orders.
 *
 * Idempotent — safe to re-run (cron refresh keeps it current).
 * Usage: tsx prisma/import-shopify-orders.ts [sinceISO=2015-01-01]
 */

// idempotent: CustomerOrder rows insert ON CONFLICT (source, orderRef) with deterministic
// ids; SalesMonthly upserts by (month, source) — re-runs converge, nothing accumulates.

const prisma = new PrismaClient();
const SHOP = (process.env.SHOPIFY_SHOP ?? "").replace(/"/g, "");
const VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";
const SINCE = process.argv[2] ?? "2015-01-01T00:00:00Z";

async function mintToken(): Promise<string> {
  const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
    }),
    // Bounded like the order pages below; a mint failure hard-fails the run
    // (nothing to import without a token) and the cron retries next night.
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`token mint failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

type Order = { id: number; email: string | null; created_at: string; total_price: string; order_number: number; cancelled_at: string | null; financial_status: string | null };

async function main() {
  const token = await mintToken();
  console.log("token minted; paging orders since", SINCE.slice(0, 10));

  let url: string | null =
    `https://${SHOP}/admin/api/${VERSION}/orders.json?status=any&limit=250&created_at_min=${encodeURIComponent(SINCE)}` +
    `&fields=id,email,created_at,total_price,order_number,cancelled_at,financial_status`;
  let fetched = 0;
  let withEmail = 0;
  const monthly = new Map<string, { orders: number; revenue: number }>();

  while (url) {
    const res: Response = await fetch(url, {
      headers: { "X-Shopify-Access-Token": token },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 2_000));
      continue;
    }
    if (!res.ok) throw new Error(`orders fetch ${res.status}: ${await res.text()}`);
    const { orders } = (await res.json()) as { orders: Order[] };

    const rows = orders.filter((o) => !o.cancelled_at);
    for (const o of rows) {
      const mk = o.created_at.slice(0, 7) + "-01";
      const m = monthly.get(mk) ?? { orders: 0, revenue: 0 };
      m.orders++;
      m.revenue += Number(o.total_price);
      monthly.set(mk, m);
    }
    const emailRows = rows.filter((o) => o.email);
    if (emailRows.length) {
      // Multi-row upsert — 82k singleton upserts would crawl.
      const values: string[] = [];
      const params: unknown[] = [];
      emailRows.forEach((o, i) => {
        const b = i * 5;
        values.push(`('co_' || md5($${b + 1} || $${b + 2}), $${b + 1}, $${b + 3}::timestamptz, $${b + 4}::numeric, $${b + 2}, 'shopify-live', $${b + 5}::boolean)`);
        params.push(o.email!.toLowerCase(), String(o.order_number), o.created_at, o.total_price,
          ["refunded", "partially_refunded"].includes(o.financial_status ?? ""));
      });
      await prisma.$executeRawUnsafe(
        `INSERT INTO concierge."CustomerOrder" (id, email, "orderedAt", "totalAmount", "orderRef", source, refunded)
         VALUES ${values.join(",")} ON CONFLICT (source, "orderRef") DO UPDATE SET refunded = EXCLUDED.refunded`,
        ...params
      );
      withEmail += emailRows.length;
    }
    fetched += orders.length;
    if (fetched % 5000 < 250) console.log(`  [${new Date().toISOString().slice(11, 19)}] ${fetched} orders fetched`);

    const link = res.headers.get("link") ?? "";
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
    await new Promise((r) => setTimeout(r, 550)); // standard REST limit: 2 req/s
  }

  // Monthly aggregates (all orders, even email-less POS ones).
  for (const [mk, v] of monthly) {
    await prisma.salesMonthly.upsert({
      where: { month_source: { month: new Date(mk), source: "shopify-live" } },
      update: { orders: v.orders, revenue: v.revenue.toFixed(2) },
      create: { month: new Date(mk), source: "shopify-live", orders: v.orders, revenue: v.revenue.toFixed(2) },
    });
  }
  // The live pull supersedes the stale warehouse rows everywhere.
  await prisma.salesMonthly.deleteMany({ where: { source: "shopify-warehouse" } });
  await prisma.customerOrder.deleteMany({ where: { source: "shopify-warehouse" } });

  console.log(`Done. ${fetched} orders fetched, ${withEmail} with email → CustomerOrder; ${monthly.size} months → SalesMonthly.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
