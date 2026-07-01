const { google } = require("googleapis");
const fs = require("fs");
const env = fs.readFileSync(__dirname + "/../.env", "utf8");
const email = env.match(/^RHEOS_GMAIL_CLIENT_EMAIL="(.+)"/m)[1];
const key = JSON.parse(env.match(/^RHEOS_GMAIL_PRIVATE_KEY=(".+")$/m)[1]);
(async () => {
  const jwt = new google.auth.JWT({ email, key, scopes: ["https://www.googleapis.com/auth/gmail.modify"], subject: "wholesale@rheosgear.com" });
  const gmail = google.gmail({ version: "v1", auth: jwt });
  const prof = await gmail.users.getProfile({ userId: "me" });
  console.log("✅ wholesale@ authenticated:", prof.data.emailAddress, "| messages:", prof.data.messagesTotal);
})().catch((e) => { console.error("❌ wholesale@ FAILED:", e.message.slice(0, 200)); process.exit(1); });
