import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendReply } from "@/lib/send";

/**
 * Confirm and send. The only outbound action, always rep-triggered.
 * Body: { draftId: string, finalBody: string }
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { draftId, finalBody } = (await req.json()) as { draftId: string; finalBody: string };

  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id },
    include: {
      customer: true,
      channelRef: true,
      tenant: { include: { channels: true } },
      messages: { where: { direction: "inbound" }, orderBy: { sentAt: "desc" }, take: 1 },
    },
  });
  const draft = await prisma.draft.findUniqueOrThrow({ where: { id: draftId } });
  // Reply from the mailbox the ticket arrived on; legacy tickets without a
  // channelId fall back to the tenant's first channel of that provider.
  const channel = ticket.channelRef ?? ticket.tenant.channels.find((c) => c.provider === ticket.channel);
  const lastInbound = ticket.messages[0];

  // Capture the rep's edit as Ledger signal (never mutates the Brain directly).
  const edited = finalBody.trim() !== draft.body.trim();
  if (edited) {
    await prisma.auditEvent.create({
      data: {
        tenantId: ticket.tenantId,
        action: "draft_edited",
        entity: `ticket:${ticket.id}`,
        meta: { draftId: draft.id, from: draft.body, to: finalBody },
      },
    });
  }

  const to = ticket.customer.email;
  if (!to) {
    return NextResponse.json({ error: "This customer has no email address to reply to." }, { status: 400 });
  }

  let sent = { providerMessageId: `stub-${Date.now()}`, live: false };
  if (channel) {
    sent = await sendReply({
      channel,
      providerThreadId: ticket.providerThreadId,
      inReplyToMessageId: lastInbound?.providerMessageId ?? "",
      to,
      subject: `Re: ${ticket.subject ?? ""}`,
      html: finalBody.replace(/\n/g, "<br>"),
    });
  }

  await prisma.draft.update({
    where: { id: draft.id },
    data: { editedBody: edited ? finalBody : null, status: "sent", sentMessageId: sent.providerMessageId },
  });
  await prisma.message.create({
    data: {
      tenantId: ticket.tenantId,
      ticketId: ticket.id,
      providerMessageId: sent.providerMessageId,
      direction: "outbound",
      fromEmail: channel?.supportAddress,
      subject: `Re: ${ticket.subject ?? ""}`,
      text: finalBody,
      sentAt: new Date(),
    },
  });
  await prisma.ticket.update({ where: { id: ticket.id }, data: { status: "replied" } });
  await prisma.auditEvent.create({
    data: {
      tenantId: ticket.tenantId,
      action: "reply_sent",
      entity: `ticket:${ticket.id}`,
      meta: { draftId: draft.id, live: sent.live },
    },
  });

  return NextResponse.json({ ok: true, live: sent.live, to });
}
