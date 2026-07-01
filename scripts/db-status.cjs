const fs=require("fs");const {Client}=require("pg");
const env=fs.readFileSync(__dirname+"/../.env","utf8");
const url=env.match(/^DATABASE_URL="(.+)"/m)[1].replace(/[?&]schema=concierge/,"");
(async()=>{const c=new Client({connectionString:url});await c.connect();
const s=(await c.query(`select status,count(*)::int n from concierge."KnowledgeItem" group by status order by status`)).rows;
console.log("KnowledgeItem by status:",s.map(r=>r.status+"="+r.n).join(", "));
await c.end();})().catch(e=>{console.error(e.message);process.exit(1);});
