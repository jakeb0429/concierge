import { PrismaClient } from "@prisma/client";
import { google, gmail_v1 } from "googleapis";

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

function client(subject: string): gmail_v1.Gmail {
  const jwt = new google.auth.JWT({
    email: process.env.RHEOS_GMAIL_CLIENT_EMAIL,
    key: (process.env.RHEOS_GMAIL_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/gmail.modify"],
    subject,
  });
  return google.gmail({ version: "v1", auth: jwt });
}

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

async function intakeMailbox(tenantId: string, channelId: string, mailbox: string) {
  const gmail = client(mailbox);
  const list = await gmail.users.messages.list({ userId: "me", labelIds: ["INBOX"], maxResults: MAX });
  const refs = list.data.messages ?? [];

  let imported = 0;
  let skipped = 0;
  for (const ref of refs) {
    const full = (await gmail.users.messages.get({ userId: "me", id: ref.id!, format: "full" })).data;
    const headers = full.payload?.headers ?? [];
    const from = parseAddr(header(headers, "from"));
    if (!from.email || from.email === mailbox) {
      skipped++; // our own outbound or unparseable sender
      continue;
    }
    const subject = header(headers, "subject");
    const text = (decode(full.payload) ?? full.snippet ?? "").slice(0, 8000);
    const sentAt = new Date(Number(full.internalDate ?? Date.now()));

    const customer = await prisma.customer.upsert({
      where: { tenantId_email: { tenantId, email: from.email } },
      update: { displayName: from.name ?? undefined },
      create: { tenantId, email: from.email, displayName: from.name },
    });
    const ticket = await prisma.ticket.upsert({
      where: { tenantId_providerThreadId: { tenantId, providerThreadId: full.threadId! } },
      update: { channelId },
      create: {
        tenantId,
        customerId: customer.id,
        channel: "gmail",
        channelId,
        subject,
        status: "new",
        providerThreadId: full.threadId!,
      },
    });
    await prisma.message.upsert({
      where: { tenantId_providerMessageId: { tenantId, providerMessageId: full.id! } },
      update: {},
      create: {
        tenantId,
        ticketId: ticket.id,
        providerMessageId: full.id!,
        direction: "inbound",
        fromEmail: from.email,
        subject,
        text,
        sentAt,
      },
    });
    imported++;
  }
  console.log(`  ${mailbox}: fetched ${refs.length}, imported ${imported}, skipped ${skipped}`);
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
