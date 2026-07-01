const fs=require("fs");const {Client}=require("pg");
const env=fs.readFileSync(__dirname+"/../.env","utf8");
const url=env.match(/^DATABASE_URL="(.+)"/m)[1].replace(/[?&]schema=concierge/,"");
(async()=>{const c=new Client({connectionString:url});await c.connect();
for(const q of [
 [`select count(*)::int n from concierge."KnowledgeItem"`,"knowledge items"],
 [`select count(*)::int n from concierge."KnowledgeItem" where embedding is null`,"…without embeddings"],
 [`select count(*)::int n from concierge."Ticket"`,"tickets"],
 [`select count(*)::int n from concierge."Draft"`,"drafts"],
 [`select count(*)::int n from concierge."AuditEvent"`,"audit events (ledger)"],
 [`select count(*)::int n from concierge."LearningSignal"`,"learning signals"],
]){const r=(await c.query(q[0])).rows[0].n;console.log(`${q[1]}: ${r}`);}
const t0=Date.now();
await c.query(`select id,title,answer,"triggerPhrases",category from concierge."KnowledgeItem" where status='approved'`);
console.log("full approved-KI scan (retrieval fast path):",Date.now()-t0,"ms");
await c.end();})().catch(e=>{console.error(e.message);process.exit(1);});
