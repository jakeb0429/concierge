/**
 * Mailgun sender — reuses the Scribe Mailgun account (same as the JFF apps).
 * Logs instead of sending when creds are absent, so dev never fails on email.
 */
import { logger } from "./log";

const MAILGUN_BASE = "https://api.mailgun.net";

/** Escape text for interpolation into an email's HTML part — bodies, subjects,
 *  and names are user/customer-controlled and must never inject markup. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Pre-live safety valve. While EMAIL_REDIRECT_TO is set, every notification
 * email is rerouted to that single address instead of its real recipients, so
 * nothing reaches a real teammate or customer before go-live. The intended
 * recipients are preserved in a subject tag + a banner so you can still see who
 * it WOULD have gone to. Clearing the env var is the go-live switch.
 * NOTE: magic-link sign-in (sendMagicLink) is intentionally NOT redirected —
 * rerouting auth links would lock every tester but the redirect address out.
 */
function applyPreLiveRedirect(msg: { to: string[]; subject: string; text: string; html: string }) {
  const redirect = process.env.EMAIL_REDIRECT_TO?.trim();
  if (!redirect) return { ...msg, redirected: false as const };
  const intended = msg.to.join(", ") || "(no recipients)";
  return {
    to: [redirect],
    subject: `[pre-live → ${intended}] ${msg.subject}`,
    text: `[PRE-LIVE REDIRECT] Would have gone to: ${intended}\n\n${msg.text}`,
    html: `<p style="background:#fff3cd;border:1px solid #ffe69c;padding:8px;border-radius:6px;font-size:12px;color:#664d03;margin:0 0 12px">PRE-LIVE REDIRECT — would have gone to: <b>${escapeHtml(intended)}</b></p>${msg.html}`,
    redirected: true as const,
  };
}

/**
 * General sender (digests, reports). Sends whenever Mailgun creds exist —
 * scripts run outside NODE_ENV=production, so unlike sendMagicLink this
 * doesn't gate on env (magic links keep their stricter dev guard).
 */
export async function sendEmail(msg: {
  to: string[];
  subject: string;
  text: string;
  html: string;
}): Promise<boolean> {
  // Pre-live guard runs FIRST — before creds, logging, or send — so a redirect
  // can never be bypassed by an early return, and the log shows the real target.
  const { to, subject, text, html, redirected } = applyPreLiveRedirect(msg);
  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  const from = process.env.EMAIL_FROM || `Concierge <no-reply@${domain}>`;
  if (!apiKey || !domain) {
    logger.info({ to, subject, live: false, redirected, preview: text.slice(0, 500) }, "[email] Mailgun not configured, logged instead of sending");
    return false;
  }
  const body = new URLSearchParams({ from, to: to.join(","), subject, text, html });
  // Bounded: a hung Mailgun socket must not stall the caller. Failures still
  // throw — the send is load-bearing, callers decide what a lost email means.
  const res = await fetch(`${MAILGUN_BASE}/v3/${domain}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Mailgun ${res.status}: ${await res.text()}`);
  return true;
}

export async function sendMagicLink({ email, url }: { email: string; url: string }): Promise<void> {
  // Intentionally NOT subject to EMAIL_REDIRECT_TO (see applyPreLiveRedirect):
  // a sign-in link must reach the person signing in, or only the redirect
  // address could ever log in. Auth is gated by NODE_ENV, not the pre-live valve.
  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  const from = process.env.EMAIL_FROM || `Concierge <no-reply@${domain}>`;
  const stamp = new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
  // Unique subject per email — prevents Gmail from threading sign-in emails
  // together (which is how stale links kept getting clicked).
  const subject = `Concierge sign-in — ${stamp} ET`;
  const text = `Sign in to Concierge:\n\n${url}\n\nThis link expires in 1 hour. If you didn't request it, ignore this email.`;
  // Show the full URL as the link text so a stale/dev link is visually obvious.
  const html = `<p>Sign in to Concierge:</p><p><a href="${url}">${url.split("?")[0]}</a></p><p style="color:#888;font-size:12px">This link expires in 1 hour and only the newest one works. If you didn't request it, ignore this email.</p>`;

  // In development, never transmit — the link is logged to the console instead.
  // Prevents real emails with localhost URLs landing in inboxes during dev/testing.
  if (process.env.NODE_ENV !== "production" || !apiKey || !domain) {
    logger.info(
      { email, url, live: false, mode: process.env.NODE_ENV !== "production" ? "dev" : "stub" },
      "[email] magic link logged instead of sent"
    );
    return;
  }

  const body = new URLSearchParams({ from, to: email, subject, text, html });
  // Bounded + still throwing: a magic link that silently never sends would
  // strand the user on "check your email", so the route must see the failure.
  const res = await fetch(`${MAILGUN_BASE}/v3/${domain}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Mailgun ${res.status}: ${await res.text()}`);
}
