const { google } = require("googleapis");
const fs = require("fs");
const env = fs.readFileSync(__dirname + "/../.env", "utf8");
const email = env.match(/^RHEOS_GMAIL_CLIENT_EMAIL="(.+)"/m)[1];
const key = JSON.parse(env.match(/^RHEOS_GMAIL_PRIVATE_KEY=(".+")$/m)[1]);
(async () => {
  const jwt = new google.auth.JWT({ email, key, scopes: ["https://www.googleapis.com/auth/gmail.modify"], subject: "hello@rheosgear.com" });
  const gmail = google.gmail({ version: "v1", auth: jwt });
  for (let i = 0; i < 10; i++) {
    const list = await gmail.users.messages.list({ userId: "me", q: 'subject:"Concierge sign-in" newer_than:1d', maxResults: 1 });
    if (list.data.messages?.length) {
      const m = await gmail.users.messages.get({ userId: "me", id: list.data.messages[0].id, format: "full" });
      const findBody = (p) => { if (p.mimeType === "text/plain" && p.body?.data) return Buffer.from(p.body.data, "base64").toString(); for (const c of p.parts ?? []) { const f = findBody(c); if (f) return f; } return null; };
      const body = findBody(m.data.payload) ?? "";
      const url = body.match(/https?:\/\/[^\s]+verify[^\s]*/)?.[0] ?? "(no link found)";
      const age = (Date.now() - Number(m.data.internalDate)) / 1000;
      console.log(`newest sign-in email (${Math.round(age)}s old):`);
      console.log("  link host:", url.split("/api/")[0]);
      process.exit(0);
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  console.log("no sign-in email arrived within 40s");
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
