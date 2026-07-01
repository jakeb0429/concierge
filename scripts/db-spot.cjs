const fs=require("fs");const {Client}=require("pg");
const env=fs.readFileSync("/Users/jacobberton/Documents/GitHub/concierge/.env","utf8");
const url=env.match(/^DATABASE_URL="(.+)"/m)[1].replace(/[?&]schema=concierge/,"");
(async()=>{const c=new Client({connectionString:url});await c.connect();
for(const t of ["Product: Coopers","Product: Biscayne XL","Wholesale displays & POS materials"]){
  const r=(await c.query(`select answer from concierge."KnowledgeItem" where title=$1`,[t])).rows[0];
  console.log("\n"+t+":\n "+(r?r.answer.slice(0,350):"(missing)"));
}
const n=(await c.query(`select count(*)::int n from concierge."KnowledgeItem"`)).rows[0].n;
console.log("\ntotal Brain entries:",n);
await c.end();})().catch(e=>{console.error(e.message);process.exit(1);});
