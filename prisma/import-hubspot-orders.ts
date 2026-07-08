import { PrismaClient } from "@prisma/client";

/**
 * B2B order import — HubSpot won deals become CustomerOrder rows (source
 * "hubspot-b2b"), joining the Shopify D2C stream so wholesale customers get
 * real lifetime value, time-since-purchase, and insight context too.
 *
 * "Won" = any pipeline stage with probability 1.0 (discovered live, not
 * hardcoded — Rheos has six fulfillment-ish won stages). The deal's first
 * associated contact supplies the email; deals with no contact email are
 * skipped (counted in the summary).
 *
 * Usage: tsx prisma/import-hubspot-orders.ts [--full]
 *   default = deals modified in the last 30 days (nightly incremental)
 *   --full  = every won deal (backfill)
 */

const prisma = new PrismaClient();
const FULL = process.argv.includes("--full");
const TOKEN = process.env.HUBSPOT_TOKEN;
const BASE = "https://api.hubapi.com";

async function hs<T>(path: string, body?: unknown, attempt = 0): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 429 && attempt < 5) {
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    return hs(path, body, attempt + 1);
  }
  if (!res.ok) throw new Error(`HubSpot ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<T>;
}

const chunk = <T,>(xs: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

async function main() {
  if (!TOKEN) throw new Error("HUBSPOT_TOKEN missing from env");
  const rheos = await prisma.tenant.findUniqueOrThrow({ where: { slug: "rheos" } });

  // Won stages, discovered from the live pipeline config.
  const pipelines = await hs<{ results: { stages: { id: string; metadata?: { probability?: string } }[] }[] }>(
    "/crm/v3/pipelines/deals"
  );
  const wonStages = pipelines.results.flatMap((p) =>
    p.stages.filter((s) => s.metadata?.probability === "1.0").map((s) => s.id)
  );
  console.log(`Won stages: ${wonStages.join(", ")}`);

  // Paged search for won deals.
  type Deal = { id: string; properties: { amount: string | null; closedate: string | null; createdate: string; dealname: string | null } };
  const deals: Deal[] = [];
  let after: string | undefined;
  const filters: object[] = [{ propertyName: "dealstage", operator: "IN", values: wonStages }];
  if (!FULL)
    filters.push({
      propertyName: "hs_lastmodifieddate",
      operator: "GTE",
      value: String(Date.now() - 30 * 86_400_000),
    });
  do {
    const page = await hs<{ results: Deal[]; paging?: { next?: { after: string } } }>(
      "/crm/v3/objects/deals/search",
      {
        filterGroups: [{ filters }],
        properties: ["amount", "closedate", "createdate", "dealname"],
        limit: 100,
        ...(after ? { after } : {}),
      }
    );
    deals.push(...page.results);
    after = page.paging?.next?.after;
  } while (after);
  console.log(`${deals.length} won deals${FULL ? " (full)" : " (last 30d modified)"}.`);

  // Deal → contact id (batch), contact id → email (batch).
  const dealToContact = new Map<string, string>();
  for (const batch of chunk(deals, 100)) {
    const assoc = await hs<{ results: { from: { id: string }; to: { toObjectId: number }[] }[] }>(
      "/crm/v4/associations/deal/contact/batch/read",
      { inputs: batch.map((d) => ({ id: d.id })) }
    );
    for (const r of assoc.results) if (r.to[0]) dealToContact.set(r.from.id, String(r.to[0].toObjectId));
  }
  const emailByContact = new Map<string, string>();
  for (const batch of chunk([...new Set(dealToContact.values())], 100)) {
    const contacts = await hs<{ results: { id: string; properties: { email: string | null } }[] }>(
      "/crm/v3/objects/contacts/batch/read",
      { inputs: batch.map((id) => ({ id })), properties: ["email"] }
    );
    for (const c of contacts.results) if (c.properties.email) emailByContact.set(c.id, c.properties.email.toLowerCase());
  }

  let upserted = 0;
  let skippedNoEmail = 0;
  for (const d of deals) {
    const email = emailByContact.get(dealToContact.get(d.id) ?? "");
    if (!email) {
      skippedNoEmail++;
      continue;
    }
    await prisma.customerOrder.upsert({
      where: { source_orderRef: { source: "hubspot-b2b", orderRef: d.id } },
      update: { email, totalAmount: Number(d.properties.amount ?? 0), tenantId: rheos.id },
      create: {
        tenantId: rheos.id,
        email,
        orderedAt: new Date(d.properties.closedate ?? d.properties.createdate),
        totalAmount: Number(d.properties.amount ?? 0),
        orderRef: d.id,
        source: "hubspot-b2b",
      },
    });
    upserted++;
  }

  await prisma.salesSource.upsert({
    where: { tenantId_key: { tenantId: rheos.id, key: "hubspot-b2b" } },
    update: { lastSyncAt: new Date(), lastCount: upserted },
    create: {
      tenantId: rheos.id,
      key: "hubspot-b2b",
      label: "HubSpot B2B (wholesale deals)",
      kind: "hubspot_deals",
      channelType: "b2b",
      active: true,
      lastSyncAt: new Date(),
      lastCount: upserted,
    },
  });
  console.log(`Done: ${upserted} B2B orders upserted, ${skippedNoEmail} deals had no contact email.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
