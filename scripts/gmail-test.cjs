const { google } = require("googleapis");
const key = require(process.env.HOME + "/Downloads/rheos-floating-s-1565969089548-e3b7b206216a.json");
const SUBJECT = "hello@rheosgear.com";
(async () => {
  const jwt = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ["https://www.googleapis.com/auth/gmail.modify"],
    subject: SUBJECT,
  });
  const gmail = google.gmail({ version: "v1", auth: jwt });
  const prof = await gmail.users.getProfile({ userId: "me" });
  const list = await gmail.users.messages.list({ userId: "me", labelIds: ["INBOX"], maxResults: 3 });
  console.log("✅ AUTHENTICATED as:", prof.data.emailAddress);
  console.log("   mailbox total messages:", prof.data.messagesTotal);
  console.log("   fetched", (list.data.messages || []).length, "recent INBOX message ids (content not printed)");
})().catch((e) => {
  console.error("❌ FAILED:", e.message);
  if (String(e.message).includes("unauthorized_client")) console.error("   → delegation not propagated yet, or scope mismatch");
  if (String(e.message).toLowerCase().includes("not found") || String(e.message).includes("failedPrecondition"))
    console.error("   → hello@ may be a group/alias, not a Gmail user mailbox");
  process.exit(1);
});
