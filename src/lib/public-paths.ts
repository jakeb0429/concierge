/**
 * The complete list of unauthenticated paths — extracted from middleware so the
 * auth surface is a pure, testable module (tests/lib/public-paths.test.ts pins
 * it). Everything not matched here requires a session.
 */
export const PUBLIC_EXACT = new Set(["/login", "/favicon.ico", "/robots.txt", "/scribe-mark.png", "/icon.png"]);
export const PUBLIC_PREFIXES = ["/api/auth", "/_next"];

export function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p));
}
