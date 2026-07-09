import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { gmailFor, extractAttachments, type AttachmentMeta } from "@/lib/gmail-client";
import { getCurrentTenant } from "@/lib/tenant";

/**
 * Stream an email attachment on demand. Bytes are never stored — Gmail is the
 * source of truth; this route impersonates the ticket's mailbox and proxies.
 * Addressed by index into the message's attachment metadata (stable), because
 * Gmail's attachmentIds rotate — we refresh them from the live message.
 */

// Route params are boundary input too — the index must actually address the
// attachment array (a non-negative integer, not NaN or a negative slice).
const paramsSchema = z.object({
  messageId: z.string().min(1),
  index: z.coerce.number().int().min(0),
});

export async function GET(_req: Request, { params }: { params: Promise<{ messageId: string; index: string }> }) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request.",
        fields: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
      { status: 400 }
    );
  }
  const { messageId, index: idx } = parsed.data;

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
