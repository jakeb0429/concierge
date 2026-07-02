const fs=require("fs");const {Client}=require("pg");
const env=fs.readFileSync(__dirname+"/../.env","utf8");
const url=env.match(/^DATABASE_URL="(.+)"/m)[1].replace(/[?&]schema=concierge/,"");
const B=`case when "daysSincePurchase"<=30 then '≤30d' when "daysSincePurchase"<=90 then '31-90d' when "daysSincePurchase"<=180 then '91-180d' when "daysSincePurchase"<=365 then '181-365d' when "daysSincePurchase"<=730 then '1-2y' else '2y+' end`;
(async()=>{const c=new Client({connectionString:url});await c.connect();
console.log("== BUCKET × CATEGORY (matched inquiries, noise excluded) ==");
const r1=(await c.query(`select ${B} b, category, count(*)::int n from concierge."AnalyticsInquiry" where "daysSincePurchase" is not null and category not in ('automated_notification','vendor_pitch') group by 1,2 order by 1,3 desc`)).rows;
const byB={};r1.forEach(r=>{(byB[r.b]=byB[r.b]||[]).push(`${r.category}=${r.n}`)});
for(const b of ['≤30d','31-90d','91-180d','181-365d','1-2y','2y+']) if(byB[b]) console.log(`  ${b}: ${byB[b].slice(0,5).join(", ")}`);
console.log("== BUCKET × SENTIMENT (noise excluded) ==");
const r2=(await c.query(`select ${B} b, "endSentiment" s, count(*)::int n from concierge."AnalyticsInquiry" where "daysSincePurchase" is not null and category not in ('automated_notification','vendor_pitch') group by 1,2 order by 1`)).rows;
const byB2={};r2.forEach(r=>{(byB2[r.b]=byB2[r.b]||{})[r.s]=r.n});
for(const b of ['≤30d','31-90d','91-180d','181-365d','1-2y','2y+']){const o=byB2[b]||{};const t=Object.values(o).reduce((a,x)=>a+x,0)||1;console.log(`  ${b}: pos=${o.positive||0}(${Math.round((o.positive||0)/t*100)}%) neg=${o.negative||0}(${Math.round((o.negative||0)/t*100)}%) unres=${o.unresolved||0}(${Math.round((o.unresolved||0)/t*100)}%) tot=${t}`);}
console.log("== CATEGORY × SENTIMENT (all real inquiries) ==");
const r3=(await c.query(`select category, "endSentiment" s, count(*)::int n from concierge."AnalyticsInquiry" where category not in ('automated_notification','vendor_pitch') group by 1,2`)).rows;
const byC={};r3.forEach(r=>{(byC[r.category]=byC[r.category]||{})[r.s]=r.n});
for(const [cat,o] of Object.entries(byC)){const t=Object.values(o).reduce((a,x)=>a+x,0);console.log(`  ${cat}: pos=${Math.round((o.positive||0)/t*100)}% neg=${Math.round((o.negative||0)/t*100)}% unres=${Math.round((o.unresolved||0)/t*100)}% (n=${t})`);}
await c.end();})().catch(e=>{console.error(e.message);process.exit(1);});
