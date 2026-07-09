import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/auth";
import { isAllowed } from "@/lib/allowlist";
import { sendMagicLink } from "@/lib/email";
import { baseUrl } from "@/lib/base-url";
import { getCurrentTenant } from "@/lib/tenant";
import { parseBody } from "@/lib/validate";
import { logger } from "@/lib/log";


const rateBucket = new Map<string, number[]>();

// Normalized in the schema so the rate bucket and the user lookup key on the
// same canonical form of the address.
const bodySchema = z.object({
  email: z.string().trim().toLowerCase().min(1),
  callbackUrl: z.string().optional(),
});

/** Request a magic link. A provisioned User row (any tenant) is the grant —
 *  the Users page is where access gets added. The env allowlist stays as a
 *  bootstrap fallback that provisions into Rheos. Response never reveals
 *  whether the email is known. */
export async function POST(req: Request) {
  const parsed = await parseBody(req, bodySchema);
  if (parsed instanceof NextResponse) return parsed;
  const { email, callbackUrl } = parsed;

  // Cheap abuse brake: 3 link requests per email per hour (in-memory — resets
  // on restart, which is fine; the response never reveals membership anyway).
  const now = Date.now();
  const hits = (rateBucket.get(email) ?? []).filter((t) => now - t < 3_600_000);
  if (hits.length >= 3) {
    // The response stays a neutral success (never reveal membership), so this
    // warn is the only visible trace that the limiter dropped a request.
    logger.warn({ email, windowHits: hits.length }, "[magic-link] rate limited, request dropped");
    return NextResponse.json({ success: true });
  }
  rateBucket.set(email, [...hits, now]);

  // Same email in several tenants → the most recently used row gets the
  // token (the in-app brand switcher moves between tenants after sign-in).
  let user = await prisma.user.findFirst({
    where: { email },
    orderBy: { lastLogin: { sort: "desc", nulls: "last" } },
  });
  if (!user) {
    if (!isAllowed(email)) return NextResponse.json({ success: true });
    const tenant = await getCurrentTenant();
    const role = email === "jacob.berton@gmail.com" || email === "jake@scribechs.com" ? "brand_admin" : "agent";
    user = await prisma.user.create({ data: { tenantId: tenant.id, email, role } });
  }

  const token = randomBytes(32).toString("hex");
  await prisma.user.update({
    where: { id: user.id },
    data: { magicLinkToken: await hashToken(token), magicLinkExpires: new Date(Date.now() + 60 * 60 * 1000) },
  });

  const verifyUrl = new URL(`${baseUrl(req)}/api/auth/magic-link/verify`);
  verifyUrl.searchParams.set("token", token);
  verifyUrl.searchParams.set("email", email);
  if (callbackUrl) verifyUrl.searchParams.set("callbackUrl", callbackUrl);

  // Delivery is fire-and-forget: the caller already got its neutral success,
  // so a Mailgun failure can only surface through this log line.
  await sendMagicLink({ email, url: verifyUrl.toString() }).catch((e) =>
    logger.error({ err: e, email }, "[magic-link] delivery failed")
  );
  // Dev-only: the clickable link, since dev never transmits real email.
  if (process.env.NODE_ENV === "development")
    logger.info({ email, url: verifyUrl.toString() }, "[magic-link] dev sign-in link");

  return NextResponse.json({ success: true });
}
