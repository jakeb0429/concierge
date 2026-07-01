const fs=require("fs");const {Client}=require("pg");
const env=fs.readFileSync(__dirname+"/../.env","utf8");
const url=env.match(/^DATABASE_URL="(.+)"/m)[1].replace(/[?&]schema=concierge/,"");
(async()=>{const c=new Client({connectionString:url});await c.connect();
const rows=(await c.query(`select title from concierge."KnowledgeItem" where category='Product Catalog' order by title limit 40`)).rows;
rows.forEach(r=>console.log(" ",r.title));
const inv=(await c.query(`select answer from concierge."KnowledgeItem" where title='Inventory & replenishment snapshot'`)).rows[0];
console.log("\nSNAPSHOT:",inv.answer.slice(0,400));
await c.end();})().catch(e=>{console.error(e.message);process.exit(1);});
