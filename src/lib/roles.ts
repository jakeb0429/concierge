import { cache } from "react";
import { auth } from "./auth";
import { logger } from "./log";

/**
 * Role model. brand_admin (and super_admin) = the triage admin: sees every
 * ticket, dispatches/overrides assignments, approves brain training, manages
 * users. team_lead + agent = specialists who work their assigned queue.
 */
export const ADMIN_ROLES = ["brand_admin", "super_admin"] as const;

export function isAdminRole(role: string | null | undefined): boolean {
  return !!role && (ADMIN_ROLES as readonly string[]).includes(role);
}

export type SessionUser = { id: string; email: string; tenantId: string; role: string };

/** The signed-in user, or null. Middleware walls the app, so null = API misuse. */
export const sessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth().catch(() => null);
  const u = session?.user;
  if (!u?.id || !u.tenantId) return null;
  return { id: u.id, email: u.email ?? "", tenantId: u.tenantId, role: u.role };
});

/** Throws a 403-shaped error for route handlers that require an admin. */
export async function requireAdmin(): Promise<SessionUser> {
  const u = await sessionUser();
  if (!u || !isAdminRole(u.role)) {
    // Auth denials warn (standards §3) — a burst here is a probing client or
    // a role misconfiguration, and the 403 body carries no identifying detail.
    logger.warn({ userId: u?.id ?? null, role: u?.role ?? null }, "[roles] admin access denied");
    const err = new Error("Admin access required.") as Error & { status: number };
    err.status = 403;
    throw err;
  }
  return u;
}
