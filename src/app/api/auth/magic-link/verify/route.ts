import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/auth";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3013";

/**
 * Verify the emailed link, then hand a fresh short-lived one-time token to the
 * login page, which completes sign-in via the credentials provider. (Keeps the
 * long-lived link out of the final signIn call.)
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const email = req.nextUrl.searchParams.get("email");
  if (!token || !email) return NextResponse.redirect(new URL(`/login?error=invalid`, APP_URL));

  const user = await prisma.user.findFirst({
    where: { email: email.toLowerCase(), magicLinkToken: hashToken(token), magicLinkExpires: { gt: new Date() } },
  });
  if (!user) return NextResponse.redirect(new URL(`/login?error=expired`, APP_URL));

  const oneTime = randomBytes(32).toString("hex");
  await prisma.user.update({
    where: { id: user.id },
    data: { magicLinkToken: hashToken(oneTime), magicLinkExpires: new Date(Date.now() + 2 * 60 * 1000) },
  });

  const params = new URLSearchParams({ magic: "verified", email: user.email, token: oneTime });
  const cb = req.nextUrl.searchParams.get("callbackUrl");
  if (cb) params.set("callbackUrl", cb);
  return NextResponse.redirect(new URL(`/login?${params.toString()}`, APP_URL));
}
