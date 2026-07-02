/**
 * Mailgun sender — reuses the Scribe Mailgun account (same as the JFF apps).
 * Logs instead of sending when creds are absent, so dev never fails on email.
 */
const MAILGUN_BASE = "https://api.mailgun.net";

export async function sendMagicLink({ email, url }: { email: string; url: string }): Promise<void> {
  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  const from = process.env.EMAIL_FROM || `Concierge <no-reply@${domain}>`;
  const subject = "Your Concierge sign-in link";
  const text = `Sign in to Concierge:\n\n${url}\n\nThis link expires in 1 hour. If you didn't request it, ignore this email.`;
  // Show the full URL as the link text so a stale/dev link is visually obvious.
  const html = `<p>Sign in to Concierge:</p><p><a href="${url}">${url.split("?")[0]}</a></p><p style="color:#888;font-size:12px">This link expires in 1 hour and only the newest one works. If you didn't request it, ignore this email.</p>`;

  // In development, never transmit — the link is logged to the console instead.
  // Prevents real emails with localhost URLs landing in inboxes during dev/testing.
  if (process.env.NODE_ENV !== "production" || !apiKey || !domain) {
    console.log(`[email:${process.env.NODE_ENV !== "production" ? "dev" : "stub"}] magic link for ${email}: ${url}`);
    return;
  }

  const body = new URLSearchParams({ from, to: email, subject, text, html });
  const res = await fetch(`${MAILGUN_BASE}/v3/${domain}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) throw new Error(`Mailgun ${res.status}: ${await res.text()}`);
}
