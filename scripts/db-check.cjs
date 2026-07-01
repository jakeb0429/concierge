// Read-only inspection of the target DB before any writes.
const fs = require("fs");
const { Client } = require("pg");

const env = fs.readFileSync(__dirname + "/../.env", "utf8");
const direct = env.match(/^DATABASE_URL="(.+)"/m)[1].replace(/[?&]schema=concierge/, "");

(async () => {
  const c = new Client({ connectionString: direct });
  await c.connect();
  const version = (await c.query("select version()")).rows[0].version;
  const schemas = (await c.query(
    "select schema_name from information_schema.schemata order by 1"
  )).rows.map((r) => r.schema_name);
  const ext = (await c.query(
    "select e.extname, n.nspname as schema from pg_extension e join pg_namespace n on n.oid=e.extnamespace order by 1"
  )).rows;
  const searchPath = (await c.query("show search_path")).rows[0].search_path;
  console.log("CONNECTED:", version.split(",")[0]);
  console.log("SCHEMAS:", schemas.join(", "));
  console.log("HAS concierge schema:", schemas.includes("concierge"));
  console.log("EXTENSIONS:", ext.map((e) => `${e.extname}@${e.schema}`).join(", "));
  console.log("VECTOR:", ext.find((e) => e.extname === "vector") ? "installed" : "NOT installed");
  console.log("SEARCH_PATH:", searchPath);
  await c.end();
})().catch((e) => {
  console.error("DB CHECK FAILED:", e.message);
  process.exit(1);
});
