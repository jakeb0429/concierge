const fs=require("fs");const {Client}=require("pg");
const env=fs.readFileSync(__dirname+"/../.env","utf8");
const url=env.match(/^DATABASE_URL="(.+)"/m)[1].replace(/[?&]schema=concierge/,"");
(async()=>{const c=new Client({connectionString:url});await c.connect();
const t=(await c.query(`select id from concierge."Tenant" where slug='rheos'`)).rows[0].id;
await c.query(`insert into concierge."LearningSignal" (id,"tenantId",kind,"proposedText","proposedTarget",occurrences,status,"createdAt")
values ('sig_demo_ui_test',$1,'recurring_steer','Reps repeatedly steer drafts with: "shorter". Consider adding a standing voice rule: keep replies under 120 words unless the question needs detail.','voice_guide',3,'open',now())
on conflict (id) do nothing`,[t]);
console.log("demo signal seeded");
await c.end();})().catch(e=>{console.error(e.message);process.exit(1);});
