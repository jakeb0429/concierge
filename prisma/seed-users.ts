import { PrismaClient } from "@prisma/client";

/**
 * Provision the team rosters Jake defined (2026-07-08) for both tenants.
 * Idempotent upserts — role/specialties/name are (re)stamped, sign-in
 * credentials (passwordHash, magic-link state) are never touched. A User row
 * IS the sign-in grant, so everyone here can request a magic link.
 *
 * Usage: tsx prisma/seed-users.ts
 */

// idempotent: User upserts by (tenantId, email); sign-in credentials are never
// touched on update, so re-runs only re-stamp role/specialties/name.

const prisma = new PrismaClient();

type Seed = { email: string; name?: string; role: string; specialties: string[] };

const ROSTER: Record<string, Seed[]> = {
  rheos: [
    // Jasmine is the persona behind hello@ — drafts sign off with the first name.
    { email: "hello@rheosgear.com", name: "Jasmine", role: "brand_admin", specialties: [] },
    // Jake's cross-brand identity — admin on BOTH tenants so the brand switcher works.
    { email: "jake@scribechs.com", name: "Jake Berton", role: "brand_admin", specialties: [] },
    // Owner-level: special-circumstance overrides/approvals + PO/purchasing mail.
    { email: "jake@rheosgear.com", name: "Jake (Rheos)", role: "team_lead", specialties: ["escalation", "purchasing_po"] },
    { email: "wholesale@rheosgear.com", name: "Rheos Wholesale", role: "agent", specialties: ["wholesale"] },
    { email: "marketing@rheosgear.com", name: "Rheos Marketing", role: "agent", specialties: ["marketing_collab"] },
    { email: "warehouse@rheosgear.com", name: "Rheos Warehouse", role: "agent", specialties: ["shipping_order_status"] },
  ],
  stingray: [
    { email: "jake@scribechs.com", name: "Jake Berton", role: "brand_admin", specialties: [] },
    { email: "hello@stingrayboats.com", name: "Stingray Support", role: "brand_admin", specialties: [] },
    { email: "marketing@stingrayboats.com", name: "Stingray Marketing", role: "agent", specialties: ["marketing_collab"] },
    { email: "blakec@stingrayboats.com", name: "Blake C", role: "agent", specialties: ["replacement_parts", "warranty"] },
    // 30 years of customer-service history — general inquiries route to Jim.
    {
      email: "jimp@stingrayboats.com",
      name: "Jim P",
      role: "agent",
      specialties: ["product_question", "shipping_order_status", "returns_exchange", "sizing_fit", "other"],
    },
    { email: "gailk@stingrayboats.com", name: "Gail K", role: "agent", specialties: ["wholesale"] },
  ],
};

async function main() {
  for (const [slug, seeds] of Object.entries(ROSTER)) {
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug } });
    console.log(`${tenant.name}:`);
    for (const s of seeds) {
      const email = s.email.toLowerCase();
      const user = await prisma.user.upsert({
        where: { tenantId_email: { tenantId: tenant.id, email } },
        update: { name: s.name, role: s.role, specialties: s.specialties },
        create: { tenantId: tenant.id, email, name: s.name, role: s.role, specialties: s.specialties },
      });
      console.log(`  ${user.email} · ${user.role} · [${user.specialties.join(", ") || "sees all"}]`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
