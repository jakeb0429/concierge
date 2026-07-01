const fs=require("fs");const {Client}=require("pg");
const env=fs.readFileSync(__dirname+"/../.env","utf8");
const url=env.match(/^DATABASE_URL="(.+)"/m)[1].replace(/[?&]schema=concierge/,"");
(async()=>{const c=new Client({connectionString:url});await c.connect();
const r=await c.query(`delete from concierge."LearningSignal" where id='sig_demo_ui_test'`);
console.log("demo signal removed:",r.rowCount);
await c.end();})().catch(e=>{console.error(e.message);process.exit(1);});
