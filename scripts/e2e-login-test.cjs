// Full production login: email → verify → credentials callback → authed page.
const { google } = require("googleapis");
const fs = require("fs");
const { execSync } = require("child_process");
const env = fs.readFileSync(__dirname + "/../.env", "utf8");
const saEmail = env.match(/^RHEOS_GMAIL_CLIENT_EMAIL="(.+)"/m)[1];
const key = JSON.parse(env.match(/^RHEOS_GMAIL_PRIVATE_KEY=(".+")$/m)[1]);
const sh = (cmd) => execSync(cmd, { encoding: "utf8" });

(async () => {
  const jwt = new google.auth.JWT({ email: saEmail, key, scopes: ["https://www.googleapis.com/auth/gmail.modify"], subject: "hello@rheosgear.com" });
  const gmail = google.gmail({ version: "v1", auth: jwt });

  // 0. request the link OURSELVES and only accept emails newer than that —
  // a pre-existing fresh email carries a superseded token (each request
  // rotates it) and produces a false CredentialsSignin failure.
  const requestedAt = Date.now();
  sh(`curl -s -X POST https://concierge.scribechs.com/api/auth/magic-link -H "Content-Type: application/json" -d '{"email":"hello@rheosgear.com"}'`);

  // 1. newest new-format sign-in email
  let verifyUrl = null;
  for (let i = 0; i < 20 && !verifyUrl; i++) {
    const list = await gmail.users.messages.list({ userId: "me", q: 'subject:"Concierge sign-in —" newer_than:1d', maxResults: 1 });
    if (list.data.messages?.length) {
      const m = await gmail.users.messages.get({ userId: "me", id: list.data.messages[0].id, format: "full" });
      if (Number(m.data.internalDate) > requestedAt - 3000) {
        const find = (p) => { if (p.mimeType === "text/plain" && p.body?.data) return Buffer.from(p.body.data, "base64").toString(); for (const c of p.parts ?? []) { const f = find(c); if (f) return f; } return null; };
        verifyUrl = (find(m.data.payload) ?? "").match(/https:\/\/concierge[^\s]+verify[^\s]*/)?.[0] ?? null;
      }
    }
    if (!verifyUrl) await new Promise((r) => setTimeout(r, 5000));
  }
  if (!verifyUrl) throw new Error("fresh sign-in email did not arrive");
  console.log("1. email link host:", new URL(verifyUrl).origin);

  // 2. follow verify → login redirect carries one-time token
  const loc = sh(`curl -s -o /dev/null -c /tmp/cj -w "%{redirect_url}" "${verifyUrl.replace(/&amp;/g, "&")}"`);
  const u = new URL(loc);
  console.log("2. verify redirects to:", u.origin + u.pathname, "| magic:", u.searchParams.get("magic"));
  const email = u.searchParams.get("email"), oneTime = u.searchParams.get("token");

  // 3. csrf
  const csrf = JSON.parse(sh(`curl -s -b /tmp/cj -c /tmp/cj https://concierge.scribechs.com/api/auth/csrf`)).csrfToken;

  // 4. credentials callback
  const dest = sh(`curl -s -o /dev/null -b /tmp/cj -c /tmp/cj -w "%{redirect_url}" -X POST https://concierge.scribechs.com/api/auth/callback/credentials --data-urlencode "csrfToken=${csrf}" --data-urlencode "email=${email}" --data-urlencode "token=${oneTime}" --data-urlencode "callbackUrl=https://concierge.scribechs.com/"`);
  console.log("3. signIn redirect:", dest || "(none)");

  // 5. authed page
  const code = sh(`curl -s -o /dev/null -b /tmp/cj -w "%{http_code}" https://concierge.scribechs.com/`);
  const authed = code === "200";
  console.log(`4. GET / with session → HTTP ${code} ${authed ? "✅ AUTHENTICATED" : "❌ not authenticated"}`);
  fs.unlinkSync("/tmp/cj");
  if (!authed || dest.includes("localhost")) process.exit(1);
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
