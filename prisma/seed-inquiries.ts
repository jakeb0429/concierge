import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Mock Rheos inbox — realistic inquiries so the loop is demoable before live Gmail.
 * Some map cleanly onto seeded knowledge (warranty, floating, comfort, story); a
 * couple are deliberately uncovered (order status, international shipping) to show
 * the coverage=none / gap flow and the "save to Brand Brain" path.
 */
const INQUIRIES: {
  name: string;
  email: string;
  subject: string;
  body: string;
  priority?: string;
}[] = [
  {
    name: "Dana Kessler",
    email: "dana.k@gmail.com",
    subject: "Scratched lens — anything you can do?",
    body: "Hi! I bought a pair of Coopers about 8 months ago and love them, but the left lens has picked up some scratches from a sandy beach day. Is there anything you can do? Do I have to buy a whole new pair?",
  },
  {
    name: "Marcus Webb",
    email: "mwebb@outlook.com",
    subject: "Do these actually float?",
    body: "About to pull the trigger on a pair for kayaking but I've been burned before — do Rheos really float if they fall in the water, or is that just marketing?",
  },
  {
    name: "Priya Nadkarni",
    email: "priya.n@gmail.com",
    subject: "Headaches with my current sunglasses",
    body: "I get tension headaches from heavier sunglasses on long boat days. Are yours actually lighter, and will they stay put if I push them up on my head?",
  },
  {
    name: "Tyler Brooks",
    email: "tbrooks@yahoo.com",
    subject: "Where's my order??",
    body: "I ordered two pairs last Tuesday (order #RH-48213) and still no tracking. Getting a little worried — can you tell me where it is?",
    priority: "high",
  },
  {
    name: "Sophie Laurent",
    email: "sophie.laurent@gmail.com",
    subject: "Do you ship to France?",
    body: "Bonjour! I'm visiting from Paris and would love a pair but I'm heading home next week. Do you ship internationally to France, and roughly what would shipping cost?",
  },
  {
    name: "Aaron Fields",
    email: "afields@gmail.com",
    subject: "What do you all stand for?",
    body: "Saw you're a Charleston brand. Before I buy — what does Rheos actually do for the environment? Trying to support companies that give back.",
  },
  {
    name: "Jenna Ruiz",
    email: "jenna.ruiz@gmail.com",
    subject: "Lens fogging up",
    body: "Love my Bahias but they fog up when I go from AC to the heat. Is there an anti-fog option or something I'm doing wrong?",
  },
  {
    name: "Coach Bill Hartman",
    email: "bhartman@rowingclub.org",
    subject: "Bulk order for our rowing team",
    body: "I coach a masters rowing club (22 athletes) and we'd like team sunglasses for the season. Do you offer any bulk or team pricing?",
    priority: "high",
  },
];

async function main() {
  const rheos = await prisma.tenant.findUniqueOrThrow({ where: { slug: "rheos" } });

  // Idempotent-ish: clear prior mock tickets for a clean re-seed.
  await prisma.ticket.deleteMany({ where: { tenantId: rheos.id } });

  let hoursAgo = 1;
  for (const q of INQUIRIES) {
    const customer = await prisma.customer.upsert({
      where: { tenantId_email: { tenantId: rheos.id, email: q.email } },
      update: { displayName: q.name },
      create: { tenantId: rheos.id, email: q.email, displayName: q.name },
    });

    const sentAt = new Date(Date.now() - hoursAgo * 3600 * 1000);
    hoursAgo += 2;

    await prisma.ticket.create({
      data: {
        tenantId: rheos.id,
        customerId: customer.id,
        channel: "gmail",
        subject: q.subject,
        status: "new",
        priority: q.priority ?? "normal",
        providerThreadId: `mock-${customer.id}-${sentAt.getTime()}`,
        messages: {
          create: {
            tenantId: rheos.id,
            providerMessageId: `mock-msg-${customer.id}-${sentAt.getTime()}`,
            direction: "inbound",
            fromEmail: q.email,
            subject: q.subject,
            text: q.body,
            sentAt,
          },
        },
      },
    });
  }

  const count = await prisma.ticket.count({ where: { tenantId: rheos.id } });
  console.log(`Seeded ${count} mock Rheos inquiries.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
