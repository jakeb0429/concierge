import { google, gmail_v1 } from "googleapis";

/** Impersonated Gmail client for a mailbox (service account + domain-wide delegation). */
export function gmailFor(mailbox: string): gmail_v1.Gmail {
  const jwt = new google.auth.JWT({
    email: process.env.RHEOS_GMAIL_CLIENT_EMAIL,
    key: (process.env.RHEOS_GMAIL_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/gmail.modify"],
    subject: mailbox,
  });
  return google.gmail({ version: "v1", auth: jwt });
}

export type AttachmentMeta = {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
};

/**
 * Walk a message payload and collect attachment metadata — regular attachments
 * AND inline images (photos pasted into the email body). Bytes are not stored;
 * they're fetched on demand by the attachment route.
 */
export function extractAttachments(part: gmail_v1.Schema$MessagePart | undefined): AttachmentMeta[] {
  if (!part) return [];
  const out: AttachmentMeta[] = [];
  const walk = (p: gmail_v1.Schema$MessagePart) => {
    if (p.body?.attachmentId) {
      const isInlineImage = (p.mimeType ?? "").startsWith("image/");
      const filename = p.filename || (isInlineImage ? `inline-${p.partId}.${(p.mimeType ?? "image/jpeg").split("/")[1]}` : "");
      if (filename) {
        out.push({
          filename,
          mimeType: p.mimeType ?? "application/octet-stream",
          size: p.body.size ?? 0,
          attachmentId: p.body.attachmentId,
        });
      }
    }
    for (const child of p.parts ?? []) walk(child);
  };
  walk(part);
  return out;
}
