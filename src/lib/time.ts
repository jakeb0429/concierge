/**
 * Request-time clock reads for server components. react-hooks/purity bans
 * Date.now() inside component render; RSC pages render once per request, so
 * reading the clock there is sound — routing it through this helper keeps
 * the rule meaningful where re-renders are real (client components).
 */
export function nowMs(): number {
  return Date.now();
}

/** A Date `ms` milliseconds in the past — filter cutoffs ("last N hours/days"). */
export function msAgo(ms: number): Date {
  return new Date(Date.now() - ms);
}
