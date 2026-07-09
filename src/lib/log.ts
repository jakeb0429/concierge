import pino from "pino";
import { randomUUID } from "crypto";

/**
 * Structured logging (DEVELOPMENT-STANDARDS §3): JSON in production (PM2
 * captures it), pretty in dev. App code logs through this — console.* is
 * lint-banned in src/. Boundary rules: inbound request context via child(),
 * outbound API failures warn/error with provider + status, auth denials warn.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  ...(process.env.NODE_ENV !== "production"
    ? { transport: { target: "pino-pretty", options: { colorize: true } } }
    : {}),
});

/** Request-scoped child logger — one requestId traces a failure end to end. */
export function requestLogger(route: string) {
  return logger.child({ route, requestId: randomUUID().slice(0, 8) });
}
