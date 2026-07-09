import { PrismaClient } from "@prisma/client";
import { gmail_v1 } from "googleapis";
import { triage, brandContextFor } from "../src/lib/triage";
import { autoAssign } from "../src/lib/assign";
import { gmailFor, extractAttachments } from "../src/lib/gmail-client";
import { extractProductMention } from "../src/lib/product-extract";

/**
 * Live Gmail intake — pulls recent INBOX messages into real tickets, for every
 * active Gmail channel (hello@, wholesale@, …) or a single specified mailbox.
 * Bounded, idempotent (upserts by thread + message id), keeps existing tickets.
 * Read-only against the mailbox; nothing is sent.
 *
 * Usage: tsx prisma/intake-gmail.ts [max=15] [mailbox] [--gated]
 */

// idempotent: Ticket upserts by (tenantId, providerThreadId), Message by (tenantId,
// providerMessageId), Customer by (tenantId, email); status flips are state-guarded.

const prisma = new PrismaClient();

/**
 * --gated: the crontab fires every 5 minutes; during business hours
 * (9am–1pm Eastern, DST-safe via the tz database) every firing runs, outside
 * them only the on-the-half-hour firings do. One cron line, two cadences.
 */
if (process.argv.includes("--gated")) {
  const [h, m] = new Date()
    .toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" })
    .split(":")
    .map(Number);
  const peak = h >= 9 && h < 13;
  if (!peak && m % 30 >= 5) process.exit(0);
}

const args = process.argv.slice(2).filter((a) => a !== "--gated");
const MAX = Number(args[0] ?? 15);
const ONLY_MAILBOX = args[1];

function header(headers: gmail_v1.Schema$MessagePartHeader[], n: string): string | null {
  return headers.find((h) => h.name?.toLowerCase() === n)?.value ?? null;
}
function parseAddr(v: string | null): { email: string | null; name: string | null } {
  if (!v) return { email: null, name: null };
  const m = v.match(/(.*)<(.+)>/);
  return m ? { name: m[1].trim().replace(/"/g, ""), email: m[2].trim() } : { name: null, email: v.trim() };
}
function decode(part: gmail_v1.Schema$MessagePart | undefined, mime = "text/plain"): string | null {
  if (!part) return null;
  if (part.mimeType === mime && part.body?.data)
    return Buffer.from(part.body.data, "base64").toString("utf-8");
  for (const p of part.parts ?? []) {
    const f = decode(p, mime);
    if (f) return f;
  }
  return null;
}

/** Import one full Gmail message (either direction) onto a ticket. */
async function importMessage(tenantId: string, ticketId: string, mailbox: string, full: gmail_v1.Schema$Message) {
  const headers = full.payload?.headers ?? [];
  const from = parseAddr(header(headers, "from"));
  const attachments = extractAttachments(full.payload);
  await prisma.message.upsert({
    where: { tenantId_providerMessageId: { tenantId, providerMessageId: full.id! } },
    // Attachments are re-stamped on upsert so re-runs backfill older rows too.
    update: { attachments: attachments.length ? attachments : undefined },
    create: {
      tenantId,
      ticketId,
      providerMessageId: full.id!,
      direction: from.email === mailbox ? "outbound" : "inbound",
      fromEmail: from.email,
      subject: header(headers, "subject"),
      text: (decode(full.payload) ?? full.snippet ?? "").slice(0, 8000),
      attachments: attachments.length ? attachments : undefined,
      sentAt: new Date(Number(full.internalDate ?? Date.now())),
    },
  });
  return attachments.length;
}

async function intakeMailbox(tenantId: string, tenantSlug: string, channelId: string, mailbox: string) {
  const gmail = gmailFor(mailbox);
  const list = await gmail.users.messages.list({ userId: "me", labelIds: ["INBOX"], maxResults: MAX });
  const threadIds = [...new Set((list.data.messages ?? []).map((m) => m.threadId!))];

  let imported = 0;
  let attachmentsFound = 0;
  const skippedNoise: string[] = [];
  for (const threadId of threadIds) {
    // Full thread — prior customer messages AND our replies, so the ticket
    // carries complete history (and every message's attachments).
    const thread = (await gmail.users.threads.get({ userId: "me", id: threadId, format: "full" })).data;
    const msgs = thread.messages ?? [];
    const firstInbound = msgs.find((m) => {
      const from = parseAddr(header(m.payload?.headers ?? [], "from"));
      return from.email && from.email !== mailbox;
    });
    if (!firstInbound) continue; // outbound-only thread — nothing to ticket

    const from = parseAddr(header(firstInbound.payload?.headers ?? [], "from"));
    const subject = header(firstInbound.payload?.headers ?? [], "subject");
    const text = (decode(firstInbound.payload) ?? firstInbound.snippet ?? "").slice(0, 8000);

    // Lowercased — Gmail From headers vary in case, and case variants would
    // fork one person into two Customer rows with split histories.
    const customerEmail = from.email!.toLowerCase();
    const customer = await prisma.customer.upsert({
      where: { tenantId_email: { tenantId, email: customerEmail } },
      update: { displayName: from.name ?? undefined },
      create: { tenantId, email: customerEmail, displayName: from.name },
    });

    // Triage NEW threads only — an existing ticket keeps its state and just
    // gains messages. Noise is archived with its category tag, never drafted.
    const existing = await prisma.ticket.findUnique({
      where: { tenantId_providerThreadId: { tenantId, providerThreadId: threadId } },
      select: { id: true, status: true },
    });
    let ticketId: string;
    if (existing) {
      // A customer writing back to a RESOLVED ticket reopens it — otherwise
      // "actually this didn't fix it" lands invisibly outside the open views.
      const lastMsg = msgs[msgs.length - 1];
      const lastFrom = parseAddr(header(lastMsg?.payload?.headers ?? [], "from"));
      const reopen = existing.status === "resolved" && lastFrom.email?.toLowerCase() !== mailbox;
      await prisma.ticket.update({
        where: { id: existing.id },
        data: { channelId, ...(reopen ? { status: "new" } : {}) },
      });
      if (reopen) {
        await prisma.auditEvent.create({
          data: { tenantId, action: "ticket_reopened", entity: `ticket:${existing.id}`, meta: { reason: "customer replied after resolve" } },
        });
        console.log(`    ↺ reopened resolved ticket (customer wrote back)`);
      }
      ticketId = existing.id;
    } else {
      const t = await triage(from.email!, subject, text, brandContextFor(tenantSlug));
      // Tag detected product mentions so the queue shows what the ticket is about.
      const pm = await extractProductMention(`${subject ?? ""}\n${text}`);
      const tags = [t.category, ...(pm.productFamily ? [`product:${pm.productFamily}`] : [])];
      const created = await prisma.ticket.create({
        data: {
          tenantId,
          customerId: customer.id,
          channel: "gmail",
          channelId,
          subject,
          status: t.isNoise ? "archived" : "new",
          priority: t.priority,
          category: t.inquiryCategory,
          tags,
          providerThreadId: threadId,
        },
      });
      ticketId = created.id;
      if (t.isNoise) skippedNoise.push(`${from.email} (${t.category})`);
      else {
        // Route to a specialist — the triage admin sees and can override.
        const assigned = await autoAssign(tenantId, created.id, t.inquiryCategory);
        if (assigned) console.log(`    → ${t.inquiryCategory} auto-assigned to ${assigned.email}`);
      }
    }

    for (const m of msgs) {
      attachmentsFound += await importMessage(tenantId, ticketId, mailbox, m);
      imported++;
    }

    // If the LAST message in the thread is ours (answered in Gmail directly,
    // or a Concierge send), the ticket is not "new" work — mark it replied so
    // the inbox separates it from tickets still needing an answer.
    const lastMsgFrom = parseAddr(header(msgs[msgs.length - 1]?.payload?.headers ?? [], "from"));
    const lastIsOurs = lastMsgFrom.email?.toLowerCase() === mailbox;
    if (lastIsOurs) {
      const current = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { status: true } });
      if (current && ["new", "drafted", "in_review"].includes(current.status)) {
        await prisma.ticket.update({ where: { id: ticketId }, data: { status: "replied" } });
        await prisma.auditEvent.create({
          data: { tenantId, action: "ticket_replied_external", entity: `ticket:${ticketId}`, meta: { source: "answered in Gmail" } },
        });
        console.log(`    ✉ marked replied (answered in Gmail)`);
      }
    }
  }
  console.log(
    `  ${mailbox}: ${threadIds.length} threads, ${imported} messages, ${attachmentsFound} attachments` +
      (skippedNoise.length ? ` | auto-archived noise: ${skippedNoise.join(", ")}` : "")
  );
}

async function main() {
  // Every tenant with an active Gmail channel — Stingray joins via the Graph
  // adapter later, so today this still resolves to Rheos's two mailboxes.
  const channels = await prisma.channel.findMany({
    where: {
      provider: "gmail",
      active: true,
      ...(ONLY_MAILBOX ? { supportAddress: ONLY_MAILBOX } : {}),
    },
    include: { tenant: { select: { id: true, slug: true } } },
  });
  console.log(`Live intake across ${channels.length} Gmail channel(s):`);
  for (const ch of channels) await intakeMailbox(ch.tenant.id, ch.tenant.slug, ch.id, ch.supportAddress);

  const total = await prisma.ticket.count({ where: { channel: "gmail" } });
  console.log(`Gmail tickets now: ${total}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
