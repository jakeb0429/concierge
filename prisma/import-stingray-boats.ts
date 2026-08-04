import { PrismaClient } from "@prisma/client";
import { createInterface } from "readline";
import { createReadStream, existsSync } from "fs";

/**
 * Stingray boat-registration import — DealersCircle ownership records as
 * CustomerOrder rows (source "dealers-circle", tenant stingray). This is what
 * lets a draft say "this sender owns a 2021 236CC delivered via Memphis Boat
 * Center" from nothing but the from-address.
 *
 *   - orderRef  = Hull ID ("/2" suffix = a later owner of the same hull)
 *   - orderedAt = when THIS owner took the boat (Owned date; Delivered fallback)
 *   - totalAmount = 0 (units-only feed — DealersCircle carries no pricing)
 *   - description = the human line the draft context renders
 *
 * Input: JSONL produced by stingray-reports/scripts/build-customer-db.py
 * (PII — lives OUTSIDE the repo, default /opt/concierge-data/stingray-boats.jsonl).
 * Idempotent: ON CONFLICT (source, orderRef) DO UPDATE with deterministic ids;
 * finishes by flipping the dealers-circle SalesSource active + stamping counts.
 *
 * Usage: tsx prisma/import-stingray-boats.ts [path-to-jsonl]
 */

const prisma = new PrismaClient();
const SOURCE = "dealers-circle";
const FILE = process.argv[2] ?? "/opt/concierge-data/stingray-boats.jsonl";

type BoatLine = {
  email: string;
  orderedAt: string;
  orderRef: string;
  buyerName: string | null;
  hullId: string | null;
  model: string | null;
  modelYear: number | null;
  deliveryYear: number;
  dealer: string | null;
  delivered: string | null;
  isCurrentOwner: boolean;
  isOriginalOwner: boolean;
  shipAddress1: string | null;
  shipCity: string | null;
  shipState: string | null;
  shipZip: string | null;
};

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

function describe(b: BoatLine): string {
  const parts = [
    `${b.modelYear ?? b.deliveryYear} ${b.model ?? "Stingray"}`,
    b.hullId ? `Hull ${b.hullId}` : null,
    b.delivered ? `delivered ${fmtDate(b.delivered)}` : `delivered ${b.deliveryYear}`,
    b.dealer ? `via ${b.dealer}` : null,
    b.isOriginalOwner ? "original owner" : "subsequent owner",
    b.isCurrentOwner ? null : "(boat since resold)",
  ].filter(Boolean);
  return parts.join(" · ");
}

async function main() {
  if (!existsSync(FILE)) throw new Error(`input not found: ${FILE}`);
  const stingray = await prisma.tenant.findUnique({ where: { slug: "stingray" } });
  if (!stingray) throw new Error("stingray tenant missing — run prisma/seed.ts first");

  const batch: BoatLine[] = [];
  let imported = 0;

  const flush = async () => {
    if (!batch.length) return;
    const values: string[] = [];
    const params: unknown[] = [];
    batch.forEach((b, i) => {
      const p = i * 11;
      values.push(
        `('co_' || md5('${SOURCE}' || $${p + 1}), $${p + 2}, $${p + 3}::timestamptz, 0, $${p + 1}, '${SOURCE}', false, ` +
          `$${p + 4}, $${p + 5}, $${p + 6}, $${p + 7}, $${p + 8}, $${p + 9}, $${p + 10}, $${p + 11})`
      );
      params.push(
        b.orderRef,
        b.email.toLowerCase(),
        b.orderedAt,
        stingray.id,
        b.buyerName,
        b.buyerName, // shipName mirrors buyer — powers related-customer name matching
        b.shipAddress1,
        b.shipCity,
        b.shipState,
        b.shipZip,
        describe(b)
      );
    });
    await prisma.$executeRawUnsafe(
      `INSERT INTO concierge."CustomerOrder" (id, email, "orderedAt", "totalAmount", "orderRef", source, refunded,
         "tenantId", "buyerName", "shipName", "shipAddress1", "shipCity", "shipState", "shipZip", description)
       VALUES ${values.join(",")}
       ON CONFLICT (source, "orderRef") DO UPDATE SET
         email = EXCLUDED.email,
         "orderedAt" = EXCLUDED."orderedAt",
         "tenantId" = EXCLUDED."tenantId",
         "buyerName" = EXCLUDED."buyerName",
         "shipName" = EXCLUDED."shipName",
         "shipAddress1" = EXCLUDED."shipAddress1",
         "shipCity" = EXCLUDED."shipCity",
         "shipState" = EXCLUDED."shipState",
         "shipZip" = EXCLUDED."shipZip",
         description = EXCLUDED.description`,
      ...params
    );
    imported += batch.length;
    batch.length = 0;
  };

  const rl = createInterface({ input: createReadStream(FILE), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    batch.push(JSON.parse(line) as BoatLine);
    if (batch.length >= 500) await flush();
  }
  await flush();

  await prisma.salesSource.update({
    where: { tenantId_key: { tenantId: stingray.id, key: SOURCE } },
    data: {
      active: true,
      lastSyncAt: new Date(),
      lastCount: imported,
      notes:
        "DealersCircle ownership records (units only, no pricing) imported from the consolidated " +
        "customer DB (stingray-reports build-customer-db.py). Refresh: re-run the export + this importer.",
    },
  });
  console.log(`imported/updated ${imported} boat registrations → source ${SOURCE} (SalesSource active)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
