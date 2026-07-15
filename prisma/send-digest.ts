import { PrismaClient } from "@prisma/client";
import { buildDigest, type DigestPeriod, type DigestData } from "../src/lib/digest";
import { getHappyHourSpecials, type HappyHourItem } from "../src/lib/happy-hour";
import { fmtDuration } from "../src/lib/response-times";
import { sendEmail, escapeHtml } from "../src/lib/email";

/**
 * Emailed operational digest — the same numbers as /digest, delivered.
 * Recipients: DIGEST_RECIPIENTS env (comma-separated), default jake@scribechs.com.
 * Tenants with zero tickets are skipped (Stingray until its channel goes live).
 *
 * Usage: tsx prisma/send-digest.ts [daily|weekly]
 * Cron:  daily 11:00 UTC (7am EDT), weekly Mondays 11:05 UTC.
 */

const prisma = new PrismaClient();
const period: DigestPeriod = process.argv[2] === "weekly" ? "weekly" : "daily";
const APP = "https://concierge.scribechs.com";

const GOLD = "#a8882e";
const GREY = "#7a7470";

function textReport(d: DigestData, happyHour: HappyHourItem[]): string {
  return [
    `${d.tenantName} — ${period} digest (${d.periodLabel})`,
    ``,
    `ACTIVITY`,
    `  New inquiries: ${d.newTickets}${d.newByCategory.length ? ` (${d.newByCategory.map((c) => `${c.label} ${c.n}`).join(", ")})` : ""}`,
    `  Replies sent: ${d.repliesSent} · Noise filtered: ${d.noiseFiltered} · Brain changes: ${d.brainChanges}`,
    ``,
    `RIGHT NOW`,
    `  Need a reply: ${d.needsReply} · Urgent: ${d.urgentOpen} · Unassigned: ${d.unassigned}`,
    `  Training pending: ${d.trainingOpen} · Expired notes: ${d.expiredNotes}`,
    ``,
    `RESPONSE TIMES (${d.responseTimes.sinceDays}d)`,
    `  Median first reply: ${fmtDuration(d.responseTimes.overall.medianMs)} · P90: ${fmtDuration(d.responseTimes.overall.p90Ms)} · Median resolution: ${fmtDuration(d.responseTimes.overall.medianResolutionMs)}`,
    ...(d.responseTimes.awaitingFirstReply.length
      ? [
          `  Awaiting first reply (${d.responseTimes.awaitingFirstReply.length}):`,
          ...d.responseTimes.awaitingFirstReply
            .slice(0, 5)
            .map((t) => `    - ${(t.subject ?? "(no subject)").slice(0, 60)} — waiting ${fmtDuration(t.waitingMs)}`),
        ]
      : []),
    ...(d.workload.length ? [``, `WORKLOAD`, ...d.workload.map((w) => `  ${w.label}: ${w.n} open`)] : []),
    ...(happyHour.length
      ? [
          ``,
          `HAPPY HOUR — CHARLESTON & MOUNT PLEASANT`,
          ...happyHour.map(
            (s) =>
              `  ${s.kind === "special" ? "NEW " : ""}${s.venue} (${s.area}): ${s.deal}${s.details ? ` — ${s.details}` : ""}`
          ),
        ]
      : []),
    ``,
    `Full view: ${APP}/digest${period === "weekly" ? "?period=weekly" : ""}`,
  ].join("\n");
}

function htmlReport(d: DigestData, happyHour: HappyHourItem[]): string {
  const h2 = (t: string) =>
    `<h2 style="font:bold 12px Arial;color:${GOLD};text-transform:uppercase;letter-spacing:1.5px;border-bottom:1px solid #ddd;padding-bottom:6px;margin:22px 0 10px">${t}</h2>`;
  const row = (k: string, v: string, tone = "#111") =>
    `<tr><td style="font:13px Arial;color:#444;padding:3px 16px 3px 0">${k}</td><td style="font:bold 13px Arial;color:${tone};text-align:right">${v}</td></tr>`;
  return `
<div style="max-width:560px;margin:0 auto;padding:8px 4px">
  <div style="font:bold 14px Arial;color:${GOLD};text-transform:uppercase;letter-spacing:2px">Concierge</div>
  <div style="font:italic 12px Arial;color:${GREY};margin-bottom:4px">${d.tenantName} • ${period} digest • ${d.periodLabel}</div>
  ${h2("Activity")}
  <table style="border-collapse:collapse">
    ${row("New inquiries", String(d.newTickets))}
    ${d.newByCategory.length ? row("By type", d.newByCategory.map((c) => `${c.label} ${c.n}`).join(" · "), "#444") : ""}
    ${row("Replies sent", String(d.repliesSent))}
    ${row("Noise filtered automatically", String(d.noiseFiltered))}
    ${row("Brain changes approved", String(d.brainChanges))}
  </table>
  ${h2("Right now")}
  <table style="border-collapse:collapse">
    ${row("Tickets needing a reply", String(d.needsReply), d.needsReply ? "#b45309" : "#111")}
    ${row("Urgent open", String(d.urgentOpen), d.urgentOpen ? "#b91c1c" : "#111")}
    ${row("Unassigned", String(d.unassigned), d.unassigned ? "#b45309" : "#111")}
    ${row("Training questions pending", String(d.trainingOpen))}
    ${row("Expired context notes to review", String(d.expiredNotes), d.expiredNotes ? "#b45309" : "#111")}
  </table>
  ${h2(`Response times (${d.responseTimes.sinceDays}d)`)}
  <table style="border-collapse:collapse">
    ${row("Median first reply", fmtDuration(d.responseTimes.overall.medianMs))}
    ${row("P90 first reply", fmtDuration(d.responseTimes.overall.p90Ms))}
    ${row("Median resolution", fmtDuration(d.responseTimes.overall.medianResolutionMs))}
    ${row("Awaiting first reply", String(d.responseTimes.awaitingFirstReply.length), d.responseTimes.awaitingFirstReply.length ? "#b45309" : "#111")}
  </table>
  ${
    d.workload.length
      ? h2("Workload") +
        `<table style="border-collapse:collapse">${d.workload.map((w) => row(w.label, `${w.n} open`)).join("")}</table>`
      : ""
  }
  ${
    happyHour.length
      ? h2("Happy hour — Charleston &amp; Mount Pleasant") +
        happyHour
          .map(
            (s) =>
              `<div style="font:13px Arial;color:#444;padding:3px 0">${
                s.kind === "special"
                  ? `<span style="font:bold 10px Arial;color:${GOLD};letter-spacing:1px">NEW</span> `
                  : ""
              }<b style="color:#111">${escapeHtml(s.venue)}</b> <span style="color:${GREY}">(${escapeHtml(s.area)})</span> — ${escapeHtml(s.deal)}${
                s.details ? `<span style="color:${GREY}"> · ${escapeHtml(s.details)}</span>` : ""
              }</div>`
          )
          .join("")
      : ""
  }
  <p style="font:12px Arial;margin-top:22px"><a href="${APP}/digest${period === "weekly" ? "?period=weekly" : ""}" style="color:#2e74b5">Open the live digest →</a></p>
</div>`;
}

async function main() {
  const recipients = (process.env.DIGEST_RECIPIENTS ?? "jake@scribechs.com")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);

  // Happy hour rides the DAILY digest only (it's the morning-announcements bit).
  const happyHour = period === "daily" ? await getHappyHourSpecials() : [];

  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true, slug: true } });
  for (const t of tenants) {
    const ticketCount = await prisma.ticket.count({ where: { tenantId: t.id } });
    if (ticketCount === 0) {
      console.log(`${t.slug}: no tickets yet — skipped.`);
      continue;
    }
    const d = await buildDigest(t.id, period);
    const stamp = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
    const sent = await sendEmail({
      to: recipients,
      subject: `${d.tenantName} ${period} digest — ${d.newTickets} new, ${d.needsReply} need a reply (${stamp})`,
      text: textReport(d, happyHour),
      html: htmlReport(d, happyHour),
    });
    console.log(`${t.slug}: ${period} digest ${sent ? "sent" : "stub-logged"} to ${recipients.join(", ")}.`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
