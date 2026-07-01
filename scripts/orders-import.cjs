// Import warehouse orders (JSON file: [{email, orderedAt, total, ref}]) into CustomerOrder.
const fs=require("fs");const {Client}=require("pg");
const env=fs.readFileSync(__dirname+"/../.env","utf8");
const url=env.match(/^DATABASE_URL="(.+)"/m)[1].replace(/[?&]schema=concierge/,"");
const rows=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
(async()=>{const c=new Client({connectionString:url});await c.connect();
let n=0;
for(const r of rows){
  await c.query(`insert into concierge."CustomerOrder"(id,email,"orderedAt","totalAmount","orderRef",source)
    values ('co_'||md5($4||$1),$1,$2,$3,$4,'shopify-warehouse') on conflict (source,"orderRef") do nothing`,
    [r.email.toLowerCase(), r.orderedAt, r.total, String(r.ref)]);
  n++;
}
console.log("imported/ensured",n,"orders");
await c.end();})().catch(e=>{console.error(e.message);process.exit(1);});
