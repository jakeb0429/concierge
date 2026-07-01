/** Who may sign in. Comma-separated AUTH_ALLOWLIST env (emails, lowercased). */
export function isAllowed(email: string): boolean {
  const list = (process.env.AUTH_ALLOWLIST ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase().trim());
}
