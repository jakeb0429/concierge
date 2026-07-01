// Idempotent, scoped setup: create the concierge schema + vector extension.
// Touches nothing in public — only creates an isolated schema for this app.
const fs = require("fs");
const { Client } = require("pg");

const env = fs.readFileSync(__dirname + "/../.env", "utf8");
const url = env.match(/^DATABASE_URL="(.+)"/m)[1].replace(/[?&]schema=concierge/, "");

(async () => {
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query("CREATE SCHEMA IF NOT EXISTS concierge");
  await c.query("CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions");
  const check = (await c.query(
    "select extname, (select nspname from pg_namespace where oid=extnamespace) as schema from pg_extension where extname='vector'"
  )).rows[0];
  const hasSchema = (await c.query(
    "select 1 from information_schema.schemata where schema_name='concierge'"
  )).rowCount;
  console.log("concierge schema:", hasSchema ? "created" : "MISSING");
  console.log("vector extension:", check ? `installed @${check.schema}` : "MISSING");
  await c.end();
})().catch((e) => {
  console.error("DB SETUP FAILED:", e.message);
  process.exit(1);
});
