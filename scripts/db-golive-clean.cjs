const fs=require("fs");const {Client}=require("pg");
const env=fs.readFileSync(__dirname+"/../.env","utf8");
const url=env.match(/^DATABASE_URL="(.+)"/m)[1].replace(/[?&]schema=concierge/,"");
(async()=>{const c=new Client({connectionString:url});await c.connect();
const t=(await c.query(`delete from concierge."Ticket" where "providerThreadId" like 'mock-%'`)).rowCount;
const cu=(await c.query(`delete from concierge."Customer" cu where not exists (select 1 from concierge."Ticket" x where x."customerId"=cu.id)`)).rowCount;
const left=(await c.query(`select count(*)::int n from concierge."Ticket"`)).rows[0].n;
console.log(`removed ${t} mock tickets, ${cu} orphaned mock customers; ${left} real tickets remain`);
await c.end();})().catch(e=>{console.error(e.message);process.exit(1);});
