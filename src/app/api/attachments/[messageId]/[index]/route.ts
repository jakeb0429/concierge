import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { gmailFor, extractAttachments, type AttachmentMeta } from "@/lib/gmail-client";
import { getCurrentTenant } from "@/lib/tenant";

/**
 * Stream an email attachment on demand. Bytes are never stored — Gmail is the
 * source of truth; this route impersonates the ticket's mailbox and proxies.
 * Addressed by index into the message's attachment metadata (stable), because
 * Gmail's attachmentIds rotate — we refresh them from the live message.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ messageId: string; index: string }> }) {
  const { messageId, index } = await params;
  const idx = Number(index);

  const tenant = await getCurrentTenant();
  const message = await prisma.message.findFirst({
    where: { id: messageId, tenantId: tenant.id },
    include: { ticket: { include: { channelRef: true } } },
  });
  if (!message?.attachments || !message.ticket.channelRef) {
    return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
  }
  const metas = message.attachments as unknown as AttachmentMeta[];
  const meta = metas[idx];
  if (!meta) return NextResponse.json({ error: "Attachment not found." }, { status: 404 });

  const gmail = gmailFor(message.ticket.channelRef.supportAddress);

  async function fetchBytes(attachmentId: string): Promise<Buffer | null> {
    try {
      const att = await gmail.users.messages.attachments.get({
        userId: "me",
        messageId: message!.providerMessageId,
        id: attachmentId,
      });
      return att.data.data ? Buffer.from(att.data.data, "base64") : null;
    } catch {
      return null;
    }
  }

  let bytes = await fetchBytes(meta.attachmentId);
  if (!bytes) {
    // attachmentId went stale — refresh from the live message and match by position.
    try {
      const fresh = await gmail.users.messages.get({
        userId: "me",
        id: message.providerMessageId,
        format: "full",
      });
      const freshMetas = extractAttachments(fresh.data.payload);
      const freshMeta = freshMetas[idx];
      if (freshMeta) {
        bytes = await fetchBytes(freshMeta.attachmentId);
        if (bytes) {
          await prisma.message.update({
            where: { id: message.id },
            data: { attachments: freshMetas as unknown as object },
          });
        }
      }
    } catch {
      /* fall through to 404 */
    }
  }
  if (!bytes) return NextResponse.json({ error: "Attachment unavailable from the mailbox." }, { status: 404 });

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": meta.mimeType,
      "Content-Disposition": `inline; filename="${meta.filename.replace(/[^\w.\- ]/g, "_")}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
