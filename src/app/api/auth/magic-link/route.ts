import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/auth";
import { isAllowed } from "@/lib/allowlist";
import { sendMagicLink } from "@/lib/email";
import { baseUrl } from "@/lib/base-url";
import { getCurrentTenant } from "@/lib/tenant";


/** Request a magic link. Only allowlisted emails get one; response never reveals which. */
export async function POST(req: Request) {
  const { email: raw, callbackUrl } = (await req.json().catch(() => ({}))) as {
    email?: string;
    callbackUrl?: string;
  };
  const email = (raw ?? "").toLowerCase().trim();
  if (!email) return NextResponse.json({ error: "Email required" }, { status: 400 });

  // Don't reveal allowlist membership — always return success.
  if (!isAllowed(email)) return NextResponse.json({ success: true });

  // First sign-in provisions the user in the Rheos tenant (jake = brand_admin).
  const tenant = await getCurrentTenant();
  const role = email === "jacob.berton@gmail.com" || email === "jake@scribechs.com" ? "brand_admin" : "agent";
  const user = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email } },
    update: {},
    create: { tenantId: tenant.id, email, role },
  });

  const token = randomBytes(32).toString("hex");
  await prisma.user.update({
    where: { id: user.id },
    data: { magicLinkToken: hashToken(token), magicLinkExpires: new Date(Date.now() + 60 * 60 * 1000) },
  });

  const verifyUrl = new URL(`${baseUrl(req)}/api/auth/magic-link/verify`);
  verifyUrl.searchParams.set("token", token);
  verifyUrl.searchParams.set("email", email);
  if (callbackUrl) verifyUrl.searchParams.set("callbackUrl", callbackUrl);

  await sendMagicLink({ email, url: verifyUrl.toString() }).catch((e) => console.error("[magic-link]", e));
  if (process.env.NODE_ENV === "development") console.log(`[magic-link] ${email} → ${verifyUrl.toString()}`);

  return NextResponse.json({ success: true });
}
