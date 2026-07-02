import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/auth";
import { isAllowed } from "@/lib/allowlist";
import { sendMagicLink } from "@/lib/email";
import { getCurrentTenant } from "@/lib/tenant";

/**
 * The link points wherever the request came from (behind nginx we get the real
 * host via headers) — no env/build dependency, so a stale build can never mint
 * a wrong-host link. Unknown hosts fall back to the canonical URL.
 */
const KNOWN_HOSTS = new Set(["concierge.scribechs.com", "localhost:3014", "127.0.0.1:3014"]);
function baseUrl(req: Request): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const proto = req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  if (KNOWN_HOSTS.has(host)) return `${proto}://${host}`;
  return process.env.NEXT_PUBLIC_APP_URL || "https://concierge.scribechs.com";
}

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
