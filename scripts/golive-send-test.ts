import { PrismaClient } from "@prisma/client";
import { sendReply } from "../src/lib/send";

/** Go-live send proof: one real email through the production send path,
 *  addressed to Jake (never a customer). Creates a real test ticket so the
 *  audit trail is honest, then transmits via the Gmail adapter. */
const prisma = new PrismaClient();

async function main() {
  const rheos = await prisma.tenant.findUniqueOrThrow({ where: { slug: "rheos" } });
  const channel = await prisma.channel.findFirstOrThrow({
    where: { tenantId: rheos.id, supportAddress: "hello@rheosgear.com" },
  });
  const customer = await prisma.customer.upsert({
    where: { tenantId_email: { tenantId: rheos.id, email: "jacob.berton@gmail.com" } },
    update: {},
    create: { tenantId: rheos.id, email: "jacob.berton@gmail.com", displayName: "Jake Berton (go-live test)" },
  });
  const ticket = await prisma.ticket.create({
    data: {
      tenantId: rheos.id,
      customerId: customer.id,
      channel: "gmail",
      channelId: channel.id,
      subject: "Concierge go-live send test",
      status: "in_review",
      tags: ["internal"],
      providerThreadId: `golive-${Math.floor(Math.random() * 1e9)}`,
    },
  });

  const res = await sendReply({
    channel,
    providerThreadId: ticket.providerThreadId,
    inReplyToMessageId: "",
    to: "jacob.berton@gmail.com",
    subject: "Concierge go-live send test",
    html:
      "This is Concierge's first live outbound email. 🎉<br><br>" +
      "Sent from hello@rheosgear.com through the production send path " +
      "(Gmail adapter, live credentials, human-confirmed flow). " +
      "If you're reading this, go-live is verified.<br><br>— Concierge",
  });

  await prisma.ticket.update({ where: { id: ticket.id }, data: { status: "replied" } });
  await prisma.auditEvent.create({
    data: { tenantId: rheos.id, action: "reply_sent", entity: `ticket:${ticket.id}`, meta: { live: res.live, goLiveTest: true } },
  });
  console.log(`send result: live=${res.live}, providerMessageId=${res.providerMessageId}`);
  if (!res.live) throw new Error("Send was NOT live — check gate/creds.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
