import { PrismaClient } from "@prisma/client";
import { randomBytes } from "crypto";
import { hashPassword } from "../src/lib/auth";

/**
 * Provision (or update) a password-login user. Having a passwordHash IS the
 * grant — there is no self-service signup path anywhere.
 *
 * Usage: tsx prisma/set-password.ts <email> [tenantSlug] [role] [password]
 *   tenantSlug defaults to "rheos"; role (default "agent") applies ONLY when
 *   creating a new user — an update never touches an existing user's role
 *   (re-stamping a password must not demote an admin). Password is generated
 *   (and printed ONCE) if omitted.
 */

// idempotent: User upsert by (tenantId, email) — a re-run re-stamps the hash (a fresh
// generated password each run is the point); the per-run AuditEvent is the log.

const prisma = new PrismaClient();
const [email, tenantSlug = "rheos", role = "agent", supplied] = process.argv.slice(2);

async function main() {
  // Strict shape check — a mis-quoted shell arg once smuggled a space into
  // the email and upserted garbage users; never trust includes("@") alone.
  if (!email || !/^\S+@\S+\.\S+$/.test(email))
    throw new Error("Usage: tsx prisma/set-password.ts <email> [tenantSlug] [role] [password]");
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: tenantSlug } });
  const password = supplied ?? randomBytes(18).toString("base64url");
  const passwordHash = await hashPassword(password);

  const user = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: email.toLowerCase() } },
    update: { passwordHash },
    create: { tenantId: tenant.id, email: email.toLowerCase(), role, passwordHash },
  });
  await prisma.auditEvent.create({
    data: { tenantId: tenant.id, action: "password_set", entity: `user:${user.id}`, meta: { tenant: tenantSlug } },
  });
  console.log(`user: ${user.email} · tenant: ${tenantSlug} · role: ${user.role}`);
  if (!supplied) console.log(`password (shown once, store it now): ${password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
