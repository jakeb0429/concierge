const fs=require("fs");const {Client}=require("pg");
const env=fs.readFileSync(__dirname+"/../.env","utf8");
const url=env.match(/^DATABASE_URL="(.+)"/m)[1].replace(/[?&]schema=concierge/,"");
const SHOPIFY=[["2025-07-01",229,15525.76],["2025-08-01",126,8330.45]]; // warehouse (stale after 8/21)
(async()=>{const c=new Client({connectionString:url});await c.connect();
for(const [m,n,rev] of SHOPIFY){
  await c.query(`insert into concierge."SalesMonthly"(month,orders,revenue,source) values($1,$2,$3,'shopify-warehouse')
    on conflict (month) do update set orders=excluded.orders, revenue=excluded.revenue, source=excluded.source`,[m,n,rev]);
}
// Amazon months straight from the live table in this same DB
const amz=(await c.query(`select date_trunc('month',"purchaseDate")::date m, count(*)::int n, round(sum(coalesce("itemsTotal",0)+coalesce("taxTotal",0)+coalesce("shippingTotal",0)-coalesce("promoTotal",0))::numeric,2) rev from public."AmazonOrder" where "orderStatus" != 'Canceled' group by 1`)).rows;
for(const r of amz){
  await c.query(`insert into concierge."SalesMonthly"(month,orders,revenue,source) values($1,$2,$3,'amazon')
    on conflict (month) do update set orders=concierge."SalesMonthly".orders+excluded.orders, revenue=concierge."SalesMonthly".revenue+excluded.revenue, source='amazon'`,[r.m,r.n,r.rev]);
}
const all=(await c.query(`select month::date,orders,revenue,source from concierge."SalesMonthly" order by month`)).rows;
all.forEach(r=>console.log(`  ${String(r.month).slice(0,15)} | ${r.orders} orders | $${r.revenue} | ${r.source}`));
await c.end();})().catch(e=>{console.error(e.message);process.exit(1);});
