const fs=require("fs");const {Client}=require("pg");
const env=fs.readFileSync(__dirname+"/../.env","utf8");
const url=env.match(/^DATABASE_URL="(.+)"/m)[1].replace(/[?&]schema=concierge/,"");
(async()=>{const c=new Client({connectionString:url});await c.connect();
const rows=(await c.query(`select m.id,m."ticketId",t.subject,m.attachments from concierge."Message" m join concierge."Ticket" t on t.id=m."ticketId" where m.attachments is not null limit 6`)).rows;
rows.forEach(r=>{const a=r.attachments;console.log(`ticket ${r.ticketId} "${(r.subject||'').slice(0,40)}" msg ${r.id}:`);a.forEach(x=>console.log(`   - ${x.filename} (${x.mimeType}, ${Math.round(x.size/1024)}KB)`));});
await c.end();})().catch(e=>{console.error(e.message);process.exit(1);});
