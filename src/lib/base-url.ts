/**
 * Canonical request origin — magic-link + verify URLs derive from the actual
 * request (behind nginx via forwarded headers), so a stale env/build can never
 * mint a wrong-host link. Unknown hosts fall back to the canonical URL.
 */
const KNOWN_HOSTS = new Set(["concierge.scribechs.com", "localhost:3014", "127.0.0.1:3014"]);

export function baseUrl(req: { headers: { get(name: string): string | null } }): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const proto =
    req.headers.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  if (KNOWN_HOSTS.has(host)) return `${proto}://${host}`;
  return process.env.NEXT_PUBLIC_APP_URL || "https://concierge.scribechs.com";
}
