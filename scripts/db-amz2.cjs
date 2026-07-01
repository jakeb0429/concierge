const fs=require("fs");const {Client}=require("pg");
const env=fs.readFileSync(__dirname+"/../.env","utf8");
const url=env.match(/^DATABASE_URL="(.+)"/m)[1].replace(/[?&]schema=concierge/,"");
(async()=>{const c=new Client({connectionString:url});await c.connect();
const monthly=(await c.query(`select date_trunc('month',"purchaseDate")::date m, count(*)::int n, round(sum(coalesce("itemsTotal",0)+coalesce("taxTotal",0)+coalesce("shippingTotal",0)-coalesce("promoTotal",0))::numeric,0) rev from public."AmazonOrder" where "orderStatus" != 'Canceled' group by 1 order by 1`)).rows;
monthly.forEach(r=>console.log(`  ${String(r.m).slice(0,10)}: ${r.n} orders, $${r.rev}`));
await c.end();})().catch(e=>{console.error(e.message);process.exit(1);});
