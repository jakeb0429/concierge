const { google } = require("googleapis");
const fs = require("fs");
const env = fs.readFileSync(__dirname + "/../.env", "utf8");
const email = env.match(/^RHEOS_GMAIL_CLIENT_EMAIL="(.+)"/m)[1];
const key = JSON.parse(env.match(/^RHEOS_GMAIL_PRIVATE_KEY=(".+")$/m)[1]);
(async () => {
  const jwt = new google.auth.JWT({ email, key, scopes: ["https://www.googleapis.com/auth/gmail.modify"], subject: "hello@rheosgear.com" });
  const gmail = google.gmail({ version: "v1", auth: jwt });
  const m = await gmail.users.messages.get({ userId: "me", id: "19f1fbcc1dab0575", format: "metadata", metadataHeaders: ["To","From","Subject"] });
  const h = (n) => m.data.payload.headers.find((x) => x.name.toLowerCase() === n)?.value;
  console.log("labels:", (m.data.labelIds || []).join(","));
  console.log("From:", h("from"), "| To:", h("to"), "| Subject:", h("subject"));
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
