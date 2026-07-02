import { PrismaClient } from "@prisma/client";
import { extractProductMention } from "../src/lib/product-extract";

/**
 * Product enrichment — re-reads each historical inquiry's first customer
 * message from HubSpot and extracts explicit product mentions (silhouette,
 * frame/lens color) + the family's attributes (wrap/lifestyle, gender).
 *
 * Resume-safe: only touches rows not yet checked (productFamily null AND not
 * marked checked via frameColor sentinel-free approach → we track with a
 * simple updatedAt-free strategy: rows where productFamily IS NULL are
 * re-checked; explicit non-mentions are cheap to re-derive).
 * Usage: tsx prisma/enrich-inquiries.ts [max]
 */

const prisma = new PrismaClient();
const HS = process.env.HUBSPOT_TOKEN!;
const MAX = Number(process.argv[2] ?? 5000);

async function hs<T>(path: string, attempt = 0): Promise<T | null> {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    headers: { Authorization: `Bearer ${HS}` },
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!res || res.status === 429) {
    if (attempt >= 5) return null;
    await new Promise((r) => setTimeout(r, res ? 11_000 : 3_000));
    return hs(path, attempt + 1);
  }
  if (!res.ok) return null;
  return res.json() as Promise<T>;
}

type Message = { type: string; direction?: string; text?: string };

async function main() {
  const todo = await prisma.analyticsInquiry.findMany({
    where: { productFamily: null, category: { notIn: ["automated_notification", "vendor_pitch"] } },
    orderBy: { threadCreatedAt: "desc" },
    take: MAX,
    select: { id: true, threadId: true },
  });
  console.log(`Enriching ${todo.length} inquiries with product mentions…`);

  let matched = 0;
  let done = 0;
  for (const q of todo) {
    const msgs = await hs<{ results: Message[] }>(
      `/conversations/v3/conversations/threads/${q.threadId}/messages?limit=30`
    );
    done++;
    if (msgs) {
      const firstIn = msgs.results.find((m) => m.type === "MESSAGE" && m.direction === "INCOMING" && (m.text ?? "").trim());
      if (firstIn) {
        const m = await extractProductMention(firstIn.text!);
        if (m.productFamily) {
          await prisma.analyticsInquiry.update({ where: { id: q.id }, data: m });
          matched++;
        }
      }
    }
    if (done % 250 === 0) console.log(`  [${new Date().toISOString().slice(11, 19)}] ${done}/${todo.length} (${matched} with product mentions)`);
    await new Promise((r) => setTimeout(r, 120));
  }
  console.log(`Done. ${done} checked, ${matched} carry an explicit product mention.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
