const fs=require("fs");const {Client}=require("pg");
const env=fs.readFileSync(__dirname+"/../.env","utf8");
const url=env.match(/^DATABASE_URL="(.+)"/m)[1].replace(/[?&]schema=concierge/,"");
(async()=>{const c=new Client({connectionString:url});await c.connect();
const rows=(await c.query(`select status,tags,"providerThreadId" like 'mock-%' as mock,count(*)::int n from concierge."Ticket" group by 1,2,3 order by 3,1`)).rows;
rows.forEach(r=>console.log(`${r.mock?'mock':'real'} | ${r.status} | tags=[${r.tags}] | ${r.n}`));
await c.end();})().catch(e=>{console.error(e.message);process.exit(1);});
