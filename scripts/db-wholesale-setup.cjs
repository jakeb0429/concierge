const fs=require("fs");const {Client}=require("pg");
const env=fs.readFileSync(__dirname+"/../.env","utf8");
const url=env.match(/^DATABASE_URL="(.+)"/m)[1].replace(/[?&]schema=concierge/,"");
(async()=>{const c=new Client({connectionString:url});await c.connect();
const t=(await c.query(`select id from concierge."Tenant" where slug='rheos'`)).rows[0].id;
await c.query(`insert into concierge."Channel" (id,"tenantId",provider,"supportAddress",active)
  values ('ch_wholesale_rheos',$1,'gmail','wholesale@rheosgear.com',true)
  on conflict ("tenantId",provider,"supportAddress") do nothing`,[t]);
const hello=(await c.query(`select id from concierge."Channel" where "supportAddress"='hello@rheosgear.com'`)).rows[0].id;
const bf=await c.query(`update concierge."Ticket" set "channelId"=$1 where channel='gmail' and "channelId" is null`,[hello]);
const chans=(await c.query(`select "supportAddress",id from concierge."Channel" where provider='gmail'`)).rows;
console.log("gmail channels:",chans.map(r=>r.supportAddress).join(", "),"| backfilled tickets:",bf.rowCount);
await c.end();})().catch(e=>{console.error(e.message);process.exit(1);});
