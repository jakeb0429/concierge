const fs=require("fs");const {Client}=require("pg");
const env=fs.readFileSync(__dirname+"/../.env","utf8");
const url=env.match(/^DATABASE_URL="(.+)"/m)[1].replace(/[?&]schema=concierge/,"");
(async()=>{const c=new Client({connectionString:url});await c.connect();
const t=(await c.query("select table_name from information_schema.tables where table_schema='public' order by 1")).rows.map(r=>r.table_name);
console.log("public tables:",t.join(", "));
for(const n of t){ if(/inventor|restock|stock|replen|product|listing|sku/i.test(n)){
  const cols=(await c.query(`select column_name from information_schema.columns where table_schema='public' and table_name='${n}' limit 14`)).rows.map(r=>r.column_name);
  const cnt=(await c.query(`select count(*)::int n from public."${n}"`)).rows[0].n;
  console.log(`\n${n} (${cnt} rows): ${cols.join(", ")}`);
}}
await c.end();})().catch(e=>{console.error(e.message);process.exit(1);});
