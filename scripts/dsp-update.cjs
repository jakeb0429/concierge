// Compute daysSincePurchase for every inquiry with a matching prior order.
// idempotent: deterministic recompute — the UPDATE derives the value from orders
// and overwrites in place, so re-runs converge to the same result.
const fs=require("fs");const {Client}=require("pg");
const env=fs.readFileSync(__dirname+"/../.env","utf8");
const url=env.match(/^DATABASE_URL="(.+)"/m)[1].replace(/[?&]schema=concierge/,"");
(async()=>{const c=new Client({connectionString:url});await c.connect();
const r=await c.query(`
  UPDATE concierge."AnalyticsInquiry" ai
  SET "daysSincePurchase" = sub.days
  FROM (
    SELECT ai2.id, extract(day from ai2."threadCreatedAt" - max(co."orderedAt"))::int AS days
    FROM concierge."AnalyticsInquiry" ai2
    JOIN concierge."CustomerOrder" co ON co.email = ai2."fromEmail" AND co."orderedAt" <= ai2."threadCreatedAt"
    GROUP BY ai2.id
  ) sub WHERE sub.id = ai.id`);
console.log("daysSincePurchase set on",r.rowCount,"inquiries");
await c.end();})().catch(e=>{console.error(e.message);process.exit(1);});
