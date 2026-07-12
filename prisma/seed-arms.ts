/**
 * Seed arm (temple) replacement inventory from Jake's Arm Report (2026-07-12).
 * Idempotent: creates missing SKUs and refreshes brand/container metadata, but
 * NEVER overwrites leftCount/rightCount on re-run, so rep edits on the Parts
 * page survive a re-seed. Rheos tenant only.
 *
 * Run:  npx tsx prisma/seed-arms.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// [container, sku, brand, left, right] — Total column is derived (left+right),
// so it is intentionally omitted. The Ellis/Reedy rows had blank totals in the
// sheet; their left/right were present and are used as-is.
const ROWS: [number, string, string, number, number][] = [
  [1, "13003-00100", "Bahias", 120, 120],
  [1, "13003-00200", "Bahias", 60, 60],
  [2, "13006-00100", "Eddies", 180, 180],
  [2, "13006-00200", "Eddies", 30, 1],
  [3, "13008-00100", "Palmettos", 40, 40],
  [4, "13009-00100", "Wyecreeks", 90, 90],
  [4, "13009-00200", "Wyecreeks", 30, 30],
  [4, "13009-00300", "Wyecreeks", 7, 7],
  [4, "13009-00700", "Wyecreeks", 10, 10],
  [4, "13009-01010", "Wyecreeks", 15, 15],
  [5, "13011-00100", "Waders", 60, 60],
  [5, "13011-00200", "Waders", 60, 60],
  [6, "13012-00100", "Coopers", 90, 90],
  [6, "13012-00200", "Coopers", 70, 70],
  [7, "13013-00100", "Breakers", 5, 5],
  [7, "13013-00200", "Breakers", 5, 5],
  [7, "13013-00300", "Breakers", 10, 10],
  [8, "13016-00100", "Amelias", 30, 30],
  [8, "13016-00200", "Amelias", 90, 90],
  [9, "13017-00100", "Folly", 60, 60],
  [9, "13017-00200", "Folly", 30, 30],
  [9, "13017-01510", "Folly", 30, 30],
  [9, "13017-02610", "Folly", 30, 30],
  [10, "13018-00100", "Edgewaters", 130, 130],
  [10, "13018-00200", "Edgewaters", 120, 120],
  [11, "13019-00100", "Biscaynes", 150, 150],
  [11, "13019-00200", "Biscaynes", 150, 150],
  [12, "13024-01570", "Saludas", 30, 30],
  [12, "13024-01670", "Saludas", 30, 30],
  [13, "13027-01410", "Laniers", 30, 30],
  [13, "13027-01670", "Laniers", 30, 30],
  [13, "13027-01710", "Laniers", 20, 20],
  [14, "13028-00100", "Tupelos", 10, 10],
  [14, "13028-01510", "Tupelos", 10, 10],
  [15, "13029-01670", "Stonos", 40, 40],
  [15, "13029-00200", "Stonos", 15, 15],
  [15, "13029-02113", "Stonos", 30, 30],
  [15, "13029-01560", "Stonos", 20, 20],
  [16, "13030-00110", "Coopers", 60, 60],
  [16, "13030-00120", "Coopers", 60, 60],
  [16, "13030-00290", "Coopers", 120, 120],
  [17, "13002-00300", "Sapelos", 80, 80],
  [17, "13031-00190", "Sapelos", 90, 90],
  [17, "13031-00240", "Sapelos", 30, 30],
  [17, "13031-00310", "Sapelos", 30, 30],
  [18, "13032-00110", "Eddies", 60, 60],
  [18, "13032-00130", "Eddies", 90, 90],
  [18, "13032-00220", "Eddies", 100, 100],
  [19, "13033-00110", "Bahias", 90, 90],
  [19, "13033-00230", "Bahias", 120, 120],
  [20, "13034-00240", "Wyecreeks", 100, 100],
  [20, "13034-02610", "Wyecreeks", 30, 30],
  [20, "13034-02113", "Wyecreeks", 30, 30],
  [20, "13034-00310", "Wyecreeks", 80, 80],
  [21, "13023-00120", "Coras", 90, 90],
  [21, "13023-00240", "Coras", 90, 90],
  [22, "13035-00212", "Waders", 90, 90],
  [22, "13035-02613", "Waders", 90, 90],
  [22, "13035-02710", "Waders", 70, 70],
  [22, "13035-02840", "Waders", 50, 50],
  [23, "13038-00120", "Biscayne XL", 30, 30],
  [23, "13038-00230", "Biscayne XL", 30, 30],
  [24, "13015-00110", "Mutiny", 60, 60],
  [24, "13015-00115", "Mutiny", 20, 20],
  [24, "13015-02113", "Mutiny", 30, 30],
  [24, "13015-00270", "Mutiny", 60, 60],
  [24, "13015-00290", "Mutiny", 60, 60],
  [25, "2116-610", "Ellis", 60, 60],
  [25, "2116-240", "Ellis", 60, 60],
  [26, "2117-110", "Reedy", 15, 15],
  [26, "2117-220", "Reedy", 15, 15],
];

async function main() {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: "rheos" } });
  let created = 0;
  let refreshed = 0;
  for (const [container, sku, brand, left, right] of ROWS) {
    const res = await prisma.armInventory.upsert({
      where: { tenantId_sku: { tenantId: tenant.id, sku } },
      // Preserve rep-edited counts on re-run; only refresh metadata.
      update: { brand, container },
      create: { tenantId: tenant.id, sku, brand, container, leftCount: left, rightCount: right },
    });
    if (res.createdAt.getTime() === res.updatedAt.getTime()) created++;
    else refreshed++;
  }
  console.log(`Arm inventory seeded: ${created} created, ${refreshed} already present (counts preserved).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
