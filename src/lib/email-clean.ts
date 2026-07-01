/**
 * Email text cleanup — turns raw email bodies (quote chains, forwards,
 * signatures, converted-HTML artifacts) into just the new content.
 *
 * Raw text stays in the DB; this runs at render time and when assembling the
 * AI's grounding text, so both the rep and the model see clean messages.
 */

const QUOTE_HEADER_PATTERNS: RegExp[] = [
  /^On .{5,200}(wrote|écrit):\s*$/im, // "On Tue, Jul 1, 2026 at 9:14 AM Jane <j@x.com> wrote:"
  /^On [A-Z][a-z]{2},? .{5,120}[\s\S]{0,160}?wrote:\s*$/m, // same, wrapped across lines
  // Apple Mail / flowed plain-text collapses the header mid-line — match only
  // the full dated form ("On Jun 30, 2026, at 11:16 AM, … wrote:") to stay safe.
  /On (?:[A-Z][a-z]{2},? )?[A-Z][a-z]{2,8}\.? \d{1,2},? \d{4},? at \d{1,2}:\d{2}\s?[AP]M[\s\S]{0,200}?wrote:/,
  /^-{2,}\s*Original Message\s*-{2,}/im,
  /^-{2,}\s*Forwarded message\s*-{2,}/im,
  /^From:\s.+$\n^(Sent|Date):\s.+$/im, // Outlook-style quoted header block
  /^_{10,}\s*$/m, // Outlook divider
  /^Le .{5,200}a écrit\s*:\s*$/im,
];

const SIGNATURE_PATTERNS: RegExp[] = [
  /^--\s*$/m, // RFC signature delimiter
  /^\*--+\*\s*$/m, // markdown-mangled delimiter ("*--*") from Gmail plain-text
  /^Sent from my (iPhone|iPad|Android|Galaxy|mobile device).*$/im,
  /^Get Outlook for (iOS|Android).*$/im,
];

export function cleanEmailText(raw: string): string {
  if (!raw) return "";
  let text = raw.replace(/\r\n/g, "\n");

  // Cut at the earliest quoted-reply header — everything after is history.
  let cut = text.length;
  for (const re of QUOTE_HEADER_PATTERNS) {
    const m = re.exec(text);
    if (m && m.index < cut) cut = m.index;
  }
  text = text.slice(0, cut);

  // Drop ">"-quoted lines that survived (inline quoting without a header).
  text = text
    .split("\n")
    .filter((l) => !/^\s*>/.test(l))
    .join("\n");

  // Trim trailing signatures ("Sent from my iPhone", "-- ").
  for (const re of SIGNATURE_PATTERNS) {
    const m = re.exec(text);
    if (m && m.index > 0) text = text.slice(0, m.index);
  }

  // Converted-HTML artifacts: zero-width chars, nbsp, long invisible runs,
  // tracking-pixel leftovers like "[image: ...]", excess blank lines.
  text = text
    .replace(/[​‌‍﻿]/g, "")
    .replace(/ /g, " ")
    .replace(/\[image:[^\]]*\]/gi, "")
    .replace(/\[cid:[^\]]*\]/gi, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // A dangling mobile signature at the very end (mid-line, so the anchored
  // patterns missed it) — trim it.
  text = text.replace(/\s*Sent from my (iPhone|iPad|Android|Galaxy)\s*$/i, "").trim();

  // If cleaning nuked everything (e.g. the whole message was a forward),
  // fall back to a trimmed slice of the raw so the rep still sees content.
  if (!text) text = raw.replace(/\n{3,}/g, "\n\n").trim().slice(0, 2000);
  return text;
}
