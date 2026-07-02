import { PrismaClient } from "@prisma/client";
import { randomBytes } from "crypto";
import { hashPassword } from "../src/lib/auth";

/**
 * Provision (or update) a password-login user. Having a passwordHash IS the
 * grant — there is no self-service signup path anywhere.
 *
 * Usage: tsx prisma/set-password.ts <email> [role] [password]
 *   role defaults to "agent"; password is generated (and printed ONCE) if omitted.
 */

const prisma = new PrismaClient();
const [email, role = "agent", supplied] = process.argv.slice(2);

async function main() {
  if (!email?.includes("@")) throw new Error("Usage: tsx prisma/set-password.ts <email> [role] [password]");
  const rheos = await prisma.tenant.findUniqueOrThrow({ where: { slug: "rheos" } });
  const password = supplied ?? randomBytes(18).toString("base64url");
  const passwordHash = await hashPassword(password);

  const user = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: rheos.id, email: email.toLowerCase() } },
    update: { passwordHash, role },
    create: { tenantId: rheos.id, email: email.toLowerCase(), role, passwordHash },
  });
  await prisma.auditEvent.create({
    data: { tenantId: rheos.id, action: "password_set", entity: `user:${user.id}`, meta: { role } },
  });
  console.log(`user: ${user.email} · role: ${user.role}`);
  if (!supplied) console.log(`password (shown once, store it now): ${password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
