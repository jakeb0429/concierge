import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/auth";
import { isAllowed } from "@/lib/allowlist";
import { sendMagicLink } from "@/lib/email";
import { baseUrl } from "@/lib/base-url";
import { getCurrentTenant } from "@/lib/tenant";


const rateBucket = new Map<string, number[]>();

/** Request a magic link. A provisioned User row (any tenant) is the grant —
 *  the Users page is where access gets added. The env allowlist stays as a
 *  bootstrap fallback that provisions into Rheos. Response never reveals
 *  whether the email is known. */
export async function POST(req: Request) {
  const { email: raw, callbackUrl } = (await req.json().catch(() => ({}))) as {
    email?: string;
    callbackUrl?: string;
  };
  const email = (raw ?? "").toLowerCase().trim();
  if (!email) return NextResponse.json({ error: "Email required" }, { status: 400 });

  // Cheap abuse brake: 3 link requests per email per hour (in-memory — resets
  // on restart, which is fine; the response never reveals membership anyway).
  const now = Date.now();
  const hits = (rateBucket.get(email) ?? []).filter((t) => now - t < 3_600_000);
  if (hits.length >= 3) return NextResponse.json({ success: true });
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

  await sendMagicLink({ email, url: verifyUrl.toString() }).catch((e) => console.error("[magic-link]", e));
  if (process.env.NODE_ENV === "development") console.log(`[magic-link] ${email} → ${verifyUrl.toString()}`);

  return NextResponse.json({ success: true });
}
