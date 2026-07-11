import { NextResponse } from "next/server";
import { baseUrl } from "@/lib/base-url";

/**
 * Switch between the full workspace and the Simple (Q&A) view. The cookie
 * overrides the user's stored default (User.preferredView) until toggled
 * back — a preference, not a permission. POST (from the header form) so
 * link prefetchers can never flip it. Redirects build on baseUrl(req), not
 * req.url — behind nginx the request URL says localhost.
 */
const dest = (mode: string) => (mode === "simple" ? "/questions" : "/");

export async function POST(req: Request, { params }: { params: Promise<{ mode: string }> }) {
  const { mode } = await params;
  if (mode !== "simple" && mode !== "full")
    return NextResponse.json({ error: "Unknown view." }, { status: 400 });
  const res = NextResponse.redirect(new URL(dest(mode), baseUrl(req)), 303);
  res.cookies.set("concierge-view", mode, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return res;
}

/**
 * GET lands here when a signed-out toggle click bounces through /login and
 * the callback replays as a plain GET. Don't 405 the user and don't set the
 * cookie from a GET (prefetch-safe) — just show them the page they wanted.
 */
export async function GET(req: Request, { params }: { params: Promise<{ mode: string }> }) {
  const { mode } = await params;
  return NextResponse.redirect(new URL(dest(mode), baseUrl(req)), 303);
}
