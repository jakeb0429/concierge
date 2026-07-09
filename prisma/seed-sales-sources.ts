import { PrismaClient } from "@prisma/client";

/**
 * Per-brand sales-intake configuration (Jake, 2026-07-08): each tenant's
 * order streams are configured individually for now; standard connectors
 * (Shopify, HubSpot) come later. Secrets live in env — these rows are the
 * admin-visible config the /sources panel manages.
 *
 * Usage: tsx prisma/seed-sales-sources.ts
 */

// idempotent: SalesSource upserts by (tenantId, key); sync stats and the
// admin-managed active flag are preserved on update.

const prisma = new PrismaClient();

const SOURCES: Record<
  string,
  { key: string; label: string; kind: string; channelType: string; active: boolean; notes?: string }[]
> = {
  rheos: [
    {
      key: "shopify-live",
      label: "Shopify (rheosgear.com)",
      kind: "shopify",
      channelType: "d2c",
      active: true,
      notes: "Full order history since 2015, refreshed nightly (import-shopify-orders cron). Client-credentials token minted per run.",
    },
    {
      key: "hubspot-b2b",
      label: "HubSpot B2B (wholesale deals)",
      kind: "hubspot_deals",
      channelType: "b2b",
      active: true,
      notes: "Won deals (probability 1.0 stages) become B2B orders; contact association supplies the email.",
    },
    {
      key: "amazon",
      label: "Amazon",
      kind: "manual",
      channelType: "d2c",
      active: true,
      notes: "Monthly revenue aggregates only (public.AmazonOrder) — feeds the sales chart, not per-customer orders.",
    },
  ],
  stingray: [
    {
      key: "dealers-circle",
      label: "Dealers Circle / ERP",
      kind: "erp",
      channelType: "b2b",
      active: false,
      notes: "Awaiting data definition with Stingray — boat sales flow through the dealer network via Dealers Circle or their ERP. Activate once the export format is agreed.",
    },
  ],
};

async function main() {
  for (const [slug, sources] of Object.entries(SOURCES)) {
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug } });
    console.log(`${tenant.name}:`);
    for (const s of sources) {
      await prisma.salesSource.upsert({
        where: { tenantId_key: { tenantId: tenant.id, key: s.key } },
        // Existing rows keep their sync stats + active state (admin-managed).
        update: { label: s.label, kind: s.kind, channelType: s.channelType, notes: s.notes },
        create: { tenantId: tenant.id, ...s },
      });
      console.log(`  ${s.key} · ${s.channelType} · ${s.active ? "active" : "inactive"}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
