import { PrismaClient } from "@prisma/client";
import { RHEOS_VOICE_GUIDE, RHEOS_SEED } from "./seed/rheos-brand-brain";

// idempotent: tenants/channels upsert by natural keys; seed knowledge items are
// created only when the (tenant, title) is absent — in-app edits are never clobbered.

const prisma = new PrismaClient();

async function main() {
  // Rheos tenant + voice guide.
  const rheos = await prisma.tenant.upsert({
    where: { slug: "rheos" },
    update: { voiceGuide: RHEOS_VOICE_GUIDE },
    create: { slug: "rheos", name: "Rheos Nautical Eyewear", voiceGuide: RHEOS_VOICE_GUIDE },
  });

  // Gmail channel for hello@rheosgear.com.
  await prisma.channel.upsert({
    where: {
      tenantId_provider_supportAddress: {
        tenantId: rheos.id,
        provider: "gmail",
        supportAddress: "hello@rheosgear.com",
      },
    },
    update: {},
    create: { tenantId: rheos.id, provider: "gmail", supportAddress: "hello@rheosgear.com" },
  });

  // Day-one Brand Brain from approved collateral (embeddings added by the ingest job).
  for (const item of RHEOS_SEED) {
    // Create-if-missing: a re-seed must not duplicate entries or overwrite
    // answers that were since refined in the Brain manager.
    const exists = await prisma.knowledgeItem.findFirst({
      where: { tenantId: rheos.id, title: item.title },
      select: { id: true },
    });
    if (exists) continue;
    await prisma.knowledgeItem.create({
      data: {
        tenantId: rheos.id,
        kind: item.kind,
        title: item.title,
        answer: item.answer,
        triggerPhrases: item.triggerPhrases,
        tags: item.tags,
        category: item.category,
        status: "approved",
        sourceRef: item.sourceRef,
      },
    });
  }

  // Stingray tenant pre-created so the M365 seam is exercised end-to-end (adapter stubbed).
  const stingray = await prisma.tenant.upsert({
    where: { slug: "stingray" },
    update: {},
    create: { slug: "stingray", name: "Stingray Boats" },
  });
  await prisma.channel.upsert({
    where: {
      tenantId_provider_supportAddress: {
        tenantId: stingray.id,
        provider: "graph",
        supportAddress: "support@stingrayboats.com",
      },
    },
    update: {},
    create: { tenantId: stingray.id, provider: "graph", supportAddress: "support@stingrayboats.com" },
  });

  console.log(`Seeded Rheos (${RHEOS_SEED.length} knowledge items) + Stingray tenant.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
