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
  const html = `<p>Sign in to Concierge:</p><p><a href="${url}">Sign in</a></p><p style="color:#888;font-size:12px">This link expires in 1 hour. If you didn't request it, ignore this email.</p>`;

  if (!apiKey || !domain) {
    console.log(`[email:stub] magic link for ${email} (no MAILGUN creds): ${url}`);
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
