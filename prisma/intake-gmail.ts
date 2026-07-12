import { PrismaClient } from "@prisma/client";
import { gmail_v1 } from "googleapis";
import { triage, brandContextFor } from "../src/lib/triage";
import { autoAssign } from "../src/lib/assign";
import { gmailFor, extractAttachments } from "../src/lib/gmail-client";
import { extractProductMention } from "../src/lib/product-extract";
import { shouldReopenOnInbound } from "../src/lib/reopen";
import {
  gmailThreadIsArchived,
  classifyExternalArchive,
  hasNoiseTag,
  GMAIL_ARCHIVED_TAG,
  MISSED_ARCHIVE_TAG,
} from "../src/lib/external-archive";

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
      // Case-insensitive: Gmail From headers vary in case (Hello@ vs hello@).
      // A case mismatch here would store our own sent reply as "inbound",
      // corrupting the outbound count that drives reopen (hasPriorOutbound).
      direction: from.email?.toLowerCase() === mailbox.toLowerCase() ? "outbound" : "inbound",
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
      select: { id: true, status: true, tags: true },
    });
    let ticketId: string;
    if (existing) {
      // A customer writing back to a RESOLVED, REPLIED, or ARCHIVED ticket
      // reopens it — otherwise "actually this didn't fix it" lands invisibly
      // outside the open views. Noise stays archived: a vendor pitching again
      // is not work.
      const lastMsg = msgs[msgs.length - 1];
      const lastFrom = parseAddr(header(lastMsg?.payload?.headers ?? [], "from"));
      // Only reopen if a genuinely NEW message arrived since we last synced this
      // ticket. Intake lists ALL INBOX threads with no watermark, so without this
      // a ticket resolved while the customer's message was the last word would
      // re-open on every poll. Compare the thread's newest message to the newest
      // message already on the ticket (both from Gmail internalDate).
      const threadNewestMs = Math.max(0, ...msgs.map((m) => Number(m.internalDate ?? 0)));
      const latestOnTicket = await prisma.message.findFirst({
        where: { ticketId: existing.id },
        orderBy: { sentAt: "desc" },
        select: { sentAt: true },
      });
      const hasNewMessage = !latestOnTicket || threadNewestMs > latestOnTicket.sentAt.getTime();
      // Did we ever reply here? A recorded outbound means we engaged the thread,
      // so a customer write-back reopens it even if it was mislabeled noise.
      const priorOutbound = await prisma.message.count({
        where: { ticketId: existing.id, direction: "outbound" },
      });
      const reopen =
        hasNewMessage &&
        shouldReopenOnInbound({
          status: existing.status,
          tags: existing.tags,
          lastFromEmail: lastFrom.email,
          mailbox,
          allowArchived: true,
          isNoise: (tags) => hasNoiseTag(tags ?? []),
          hasPriorOutbound: priorOutbound > 0,
        });
      await prisma.ticket.update({
        where: { id: existing.id },
        data: {
          channelId,
          ...(reopen
            ? {
                status: "new",
                // The thread is live again — clear any external-archive marks.
                tags: existing.tags.filter((t) => t !== GMAIL_ARCHIVED_TAG && t !== MISSED_ARCHIVE_TAG),
              }
            : {}),
        },
      });
      if (reopen) {
        const after = existing.status === "resolved" ? "resolve" : existing.status === "replied" ? "reply" : existing.status === "waiting_on_customer" ? "waiting" : "archive";
        await prisma.auditEvent.create({
          data: { tenantId, action: "ticket_reopened", entity: `ticket:${existing.id}`, meta: { reason: `customer replied after ${after}` } },
        });
        console.log(`    ↺ reopened ${existing.status} ticket (customer wrote back)`);
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
    const lastIsOurs = lastMsgFrom.email?.toLowerCase() === mailbox.toLowerCase();
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

/**
 * Mailbox→Concierge archive sync — the inverse of the bulk-archive flow.
 * Intake only lists INBOX, so a thread archived in Gmail simply goes dark;
 * this sweep checks every open ticket's thread and toggles the ticket off
 * when the mailbox side archived (or deleted) it. Archives that still looked
 * like live work (awaiting a reply, urgent, return in flight) get the
 * MISSED_ARCHIVE_TAG so the inbox shows them in "Did you miss this?" instead
 * of hiding them silently. Idempotent: archived tickets leave the candidate
 * set, and a reopen clears the tags (restore also re-inboxes the thread).
 */
async function syncExternalArchives(tenantId: string, channelId: string, mailbox: string) {
  const gmail = gmailFor(mailbox);
  const candidates = await prisma.ticket.findMany({
    where: {
      tenantId,
      channelId,
      status: { notIn: ["archived", "resolved"] },
      NOT: { providerThreadId: { startsWith: "mock-" } },
    },
    select: {
      id: true,
      subject: true,
      status: true,
      priority: true,
      tags: true,
      returnStatus: true,
      providerThreadId: true,
      messages: { orderBy: { sentAt: "desc" }, take: 1, select: { direction: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 300,
  });
  if (candidates.length === 300) console.log(`    (archive sweep capped at 300 oldest open tickets)`);

  let archived = 0;
  let flagged = 0;
  for (const t of candidates) {
    let gone = false;
    let labels: { labelIds?: string[] | null }[] = [];
    try {
      const thread = await gmail.users.threads.get({ userId: "me", id: t.providerThreadId, format: "minimal" });
      labels = (thread.data.messages ?? []).map((m) => ({ labelIds: m.labelIds }));
    } catch (e) {
      const status = (e as { status?: number; code?: number }).status ?? Number((e as { code?: unknown }).code);
      if (status === 404) gone = true; // deleted/expunged — gone from the mailbox too
      else {
        console.error(`    archive sweep: threads.get failed for ticket ${t.id}: ${e}`);
        continue; // transient failure — never archive on a guess
      }
    }
    if (!gone && !gmailThreadIsArchived(labels)) continue;

    const { flag, reasons } = classifyExternalArchive({
      status: t.status,
      priority: t.priority,
      tags: t.tags,
      returnStatus: t.returnStatus,
      lastMessageDirection: t.messages[0]?.direction ?? null,
    });
    await prisma.ticket.update({
      where: { id: t.id },
      data: {
        status: "archived",
        tags: [...new Set([...t.tags, GMAIL_ARCHIVED_TAG, ...(flag ? [MISSED_ARCHIVE_TAG] : [])])],
      },
    });
    await prisma.auditEvent.create({
      data: {
        tenantId,
        action: "external_archive_synced",
        entity: `ticket:${t.id}`,
        meta: { mailbox, flagged: flag, reasons, ...(gone ? { threadGone: true } : {}) },
      },
    });
    archived++;
    if (flag) {
      flagged++;
      console.log(`    ⚑ archived in Gmail but looks live — "did you miss this?": ${(t.subject ?? "(no subject)").slice(0, 50)} (${reasons.join("; ")})`);
    }
  }
  if (archived) console.log(`    ⇤ ${mailbox}: ${archived} ticket(s) archived from the Gmail side, ${flagged} flagged for review`);
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
  for (const ch of channels) {
    await intakeMailbox(ch.tenant.id, ch.tenant.slug, ch.id, ch.supportAddress);
    // Sweep failures must not block the next mailbox's intake.
    await syncExternalArchives(ch.tenant.id, ch.id, ch.supportAddress).catch((e) =>
      console.error(`  archive sweep failed for ${ch.supportAddress}:`, e)
    );
  }

  const total = await prisma.ticket.count({ where: { channel: "gmail" } });
  console.log(`Gmail tickets now: ${total}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
