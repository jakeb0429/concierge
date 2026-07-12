import { PrismaClient } from "@prisma/client";
import { triage, brandContextFor } from "../src/lib/triage";
import { autoAssign } from "../src/lib/assign";
import { extractProductMention } from "../src/lib/product-extract";
import { shouldReopenOnInbound } from "../src/lib/reopen";
import { credentialsFor } from "../src/lib/send";
import { GraphMailAdapter, MSG_SELECT, graphBodyText, type GraphMessage } from "../src/lib/channels/graph";

/**
 * Live Microsoft Graph (Outlook/M365) intake — pulls recent INBOX messages
 * into real tickets for every active graph channel (Stingray's
 * hello@stingrayboats.com), or a single specified mailbox. Mirrors
 * intake-gmail.ts: bounded, idempotent (upserts by conversation + message
 * id), keeps existing tickets. Read-only against the mailbox.
 *
 * Usage: tsx prisma/intake-graph.ts [max=15] [mailbox]
 */

// idempotent: Ticket upserts by (tenantId, providerThreadId=conversationId), Message
// by (tenantId, providerMessageId), Customer by (tenantId, email); status flips are
// state-guarded — re-runs converge.

const prisma = new PrismaClient();
const MAX = Number(process.argv[2] ?? 15);
const ONLY_MAILBOX = process.argv[3];

type AttachmentMeta = { filename: string; mimeType: string; size: number; attachmentId: string };

const graphGet = <T,>(adapter: GraphMailAdapter, _mailbox: string, path: string): Promise<T> =>
  adapter.api<T>("GET", path);

async function intakeMailbox(tenantId: string, tenantSlug: string, channelId: string, mailbox: string) {
  const creds = credentialsFor("graph");
  if (!creds) {
    console.log(`  ${mailbox}: STINGRAY_GRAPH_* credentials missing — skipped`);
    return;
  }
  const adapter = new GraphMailAdapter({ tenantId, provider: "graph", supportAddress: mailbox, credentials: creds });

  const inbox = await graphGet<{ value: GraphMessage[] }>(
    adapter, mailbox,
    `/mailFolders/inbox/messages?$top=${MAX}&$orderby=receivedDateTime desc&$select=${MSG_SELECT}`
  );
  const conversationIds = [...new Set((inbox.value ?? []).map((m) => m.conversationId))];

  let imported = 0;
  let attachmentsFound = 0;
  const skippedNoise: string[] = [];
  for (const conversationId of conversationIds) {
    // Full conversation across folders (Sent Items included) so the ticket
    // carries our replies too — direction falls out of the from address.
    const thread = await graphGet<{ value: GraphMessage[] }>(
      adapter, mailbox,
      `/messages?$filter=conversationId eq '${conversationId.replace(/'/g, "''")}'&$top=50&$select=${MSG_SELECT}`
    );
    const msgs = (thread.value ?? []).sort(
      (a, b) => new Date(a.receivedDateTime ?? 0).getTime() - new Date(b.receivedDateTime ?? 0).getTime()
    );
    const mbx = mailbox.toLowerCase();
    const firstInbound = msgs.find((m) => {
      const from = m.from?.emailAddress?.address?.toLowerCase();
      return from && from !== mbx;
    });
    if (!firstInbound) continue; // outbound-only thread — nothing to ticket

    const fromEmail = firstInbound.from!.emailAddress!.address!.toLowerCase();
    const fromName = firstInbound.from?.emailAddress?.name ?? null;
    const subject = firstInbound.subject;
    const text = graphBodyText(firstInbound).slice(0, 8000);

    const customer = await prisma.customer.upsert({
      where: { tenantId_email: { tenantId, email: fromEmail } },
      update: { displayName: fromName ?? undefined },
      create: { tenantId, email: fromEmail, displayName: fromName },
    });

    const existing = await prisma.ticket.findUnique({
      where: { tenantId_providerThreadId: { tenantId, providerThreadId: conversationId } },
      select: { id: true, status: true },
    });
    let ticketId: string;
    if (existing) {
      const last = msgs[msgs.length - 1];
      const lastFrom = last?.from?.emailAddress?.address?.toLowerCase();
      // Archived reopen is deliberately Gmail-only — Graph doesn't mirror
      // external archives, so an archived ticket here was archived on purpose.
      const reopen = shouldReopenOnInbound({
        status: existing.status,
        tags: null,
        lastFromEmail: lastFrom,
        mailbox: mbx,
        allowArchived: false,
        isNoise: () => false,
      });
      await prisma.ticket.update({
        where: { id: existing.id },
        data: { channelId, ...(reopen ? { status: "new" } : {}) },
      });
      if (reopen) {
        await prisma.auditEvent.create({
          data: { tenantId, action: "ticket_reopened", entity: `ticket:${existing.id}`, meta: { reason: `customer replied after ${existing.status === "resolved" ? "resolve" : "reply"}` } },
        });
        console.log(`    ↺ reopened ${existing.status} ticket (customer wrote back)`);
      }
      ticketId = existing.id;
    } else {
      const t = await triage(fromEmail, subject, text, brandContextFor(tenantSlug));
      const pm = await extractProductMention(`${subject ?? ""}\n${text}`);
      const tags = [t.category, ...(pm.productFamily ? [`product:${pm.productFamily}`] : [])];
      const created = await prisma.ticket.create({
        data: {
          tenantId,
          customerId: customer.id,
          channel: "graph",
          channelId,
          subject,
          status: t.isNoise ? "archived" : "new",
          priority: t.priority,
          category: t.inquiryCategory,
          tags,
          providerThreadId: conversationId,
        },
      });
      ticketId = created.id;
      if (t.isNoise) skippedNoise.push(`${fromEmail} (${t.category})`);
      else {
        const assigned = await autoAssign(tenantId, created.id, t.inquiryCategory);
        if (assigned) console.log(`    → ${t.inquiryCategory} auto-assigned to ${assigned.email}`);
      }
    }

    for (const m of msgs) {
      let attachments: AttachmentMeta[] = [];
      // Outlook quirk: hasAttachments stays FALSE when the only attachments
      // are inline images pasted into the body (referenced by cid: in the
      // HTML) — which is exactly how customers send photos. Fetch the
      // attachment list whenever either signal fires.
      const hasInlineRefs =
        m.body?.contentType?.toLowerCase() === "html" && (m.body.content ?? "").includes("cid:");
      if (m.hasAttachments || hasInlineRefs) {
        const atts = await graphGet<{
          value: { id: string; name: string | null; contentType: string | null; size: number | null }[];
        }>(
          adapter, mailbox,
          `/messages/${encodeURIComponent(m.id)}/attachments?$select=id,name,contentType,size`
        );
        attachments = (atts.value ?? []).map((a, i) => ({
          filename: a.name || `inline-${i + 1}.${(a.contentType ?? "image/jpeg").split("/")[1] ?? "bin"}`,
          mimeType: a.contentType ?? "application/octet-stream",
          size: a.size ?? 0,
          attachmentId: a.id,
        }));
        attachmentsFound += attachments.length;
      }
      const fromAddr = m.from?.emailAddress?.address?.toLowerCase() ?? null;
      await prisma.message.upsert({
        where: { tenantId_providerMessageId: { tenantId, providerMessageId: m.id } },
        update: { attachments: attachments.length ? attachments : undefined },
        create: {
          tenantId,
          ticketId,
          providerMessageId: m.id,
          direction: fromAddr === mbx ? "outbound" : "inbound",
          fromEmail: fromAddr,
          subject: m.subject,
          text: graphBodyText(m).slice(0, 8000),
          html: m.body?.contentType?.toLowerCase() === "html" ? m.body.content : null,
          attachments: attachments.length ? attachments : undefined,
          sentAt: new Date(m.receivedDateTime ?? m.sentDateTime ?? Date.now()),
        },
      });
      imported++;
    }

    // Answered in Outlook directly (or by a Concierge send): last message is
    // ours — separate it from tickets still needing an answer.
    const lastFrom = msgs[msgs.length - 1]?.from?.emailAddress?.address?.toLowerCase();
    if (lastFrom === mbx) {
      const current = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { status: true } });
      if (current && ["new", "drafted", "in_review"].includes(current.status)) {
        await prisma.ticket.update({ where: { id: ticketId }, data: { status: "replied" } });
        await prisma.auditEvent.create({
          data: { tenantId, action: "ticket_replied_external", entity: `ticket:${ticketId}`, meta: { source: "answered in Outlook" } },
        });
        console.log(`    ✉ marked replied (answered in Outlook)`);
      }
    }
  }
  console.log(
    `  ${mailbox}: ${conversationIds.length} conversations, ${imported} messages, ${attachmentsFound} attachments` +
      (skippedNoise.length ? ` | auto-archived noise: ${skippedNoise.join(", ")}` : "")
  );
}

async function main() {
  const channels = await prisma.channel.findMany({
    where: {
      provider: "graph",
      active: true,
      ...(ONLY_MAILBOX ? { supportAddress: ONLY_MAILBOX } : {}),
    },
    include: { tenant: { select: { id: true, slug: true } } },
  });
  console.log(`Live intake across ${channels.length} Graph channel(s):`);
  for (const ch of channels) {
    // One mailbox failing (e.g. not yet in the ApplicationAccessPolicy group)
    // must not kill intake for the others.
    try {
      await intakeMailbox(ch.tenant.id, ch.tenant.slug, ch.id, ch.supportAddress);
    } catch (e) {
      console.error(`  ${ch.supportAddress}: intake failed —`, e instanceof Error ? e.message : e);
    }
  }

  const total = await prisma.ticket.count({ where: { channel: "graph" } });
  console.log(`Graph tickets now: ${total}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
