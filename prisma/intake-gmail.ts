import { PrismaClient } from "@prisma/client";
import { gmail_v1 } from "googleapis";
import { triage } from "../src/lib/triage";
import { gmailFor, extractAttachments } from "../src/lib/gmail-client";
import { extractProductMention } from "../src/lib/product-extract";

/**
 * Live Gmail intake — pulls recent INBOX messages into real tickets, for every
 * active Gmail channel (hello@, wholesale@, …) or a single specified mailbox.
 * Bounded, idempotent (upserts by thread + message id), keeps existing tickets.
 * Read-only against the mailbox; nothing is sent.
 *
 * Usage: tsx prisma/intake-gmail.ts [max=15] [mailbox]
 */

const prisma = new PrismaClient();
const MAX = Number(process.argv[2] ?? 15);
const ONLY_MAILBOX = process.argv[3];

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

async function intakeMailbox(tenantId: string, channelId: string, mailbox: string) {
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

    const customer = await prisma.customer.upsert({
      where: { tenantId_email: { tenantId, email: from.email! } },
      update: { displayName: from.name ?? undefined },
      create: { tenantId, email: from.email!, displayName: from.name },
    });

    // Triage NEW threads only — an existing ticket keeps its state and just
    // gains messages. Noise is archived with its category tag, never drafted.
    const existing = await prisma.ticket.findUnique({
      where: { tenantId_providerThreadId: { tenantId, providerThreadId: threadId } },
      select: { id: true },
    });
    let ticketId: string;
    if (existing) {
      await prisma.ticket.update({ where: { id: existing.id }, data: { channelId } });
      ticketId = existing.id;
    } else {
      const t = await triage(from.email!, subject, text);
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
          tags,
          providerThreadId: threadId,
        },
      });
      ticketId = created.id;
      if (t.isNoise) skippedNoise.push(`${from.email} (${t.category})`);
    }

    for (const m of msgs) {
      attachmentsFound += await importMessage(tenantId, ticketId, mailbox, m);
      imported++;
    }
  }
  console.log(
    `  ${mailbox}: ${threadIds.length} threads, ${imported} messages, ${attachmentsFound} attachments` +
      (skippedNoise.length ? ` | auto-archived noise: ${skippedNoise.join(", ")}` : "")
  );
}

async function main() {
  const rheos = await prisma.tenant.findUniqueOrThrow({ where: { slug: "rheos" } });
  const channels = await prisma.channel.findMany({
    where: {
      tenantId: rheos.id,
      provider: "gmail",
      active: true,
      ...(ONLY_MAILBOX ? { supportAddress: ONLY_MAILBOX } : {}),
    },
  });
  console.log(`Live intake across ${channels.length} Gmail channel(s):`);
  for (const ch of channels) await intakeMailbox(rheos.id, ch.id, ch.supportAddress);

  const total = await prisma.ticket.count({ where: { tenantId: rheos.id, channel: "gmail" } });
  console.log(`Rheos gmail tickets now: ${total}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
