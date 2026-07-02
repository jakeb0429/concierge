import { PrismaClient } from "@prisma/client";

/**
 * Prisma with connection-blip resilience. The Supabase pooler sits behind an
 * AWS NLB that intermittently drops/refuses connects for a moment (observed
 * live: P1001 "Can't reach database server" then 8/8 successes seconds later).
 * Every query retries connection-class errors with a short backoff, so a blip
 * costs ~1s of latency instead of an error page. Safe to retry: these errors
 * occur before a statement executes.
 */
const CONNECTION_ERROR = /Can't reach database server|P1001|ECONNREFUSED|ETIMEDOUT|Connection terminated|Closed by the/i;

async function withRetry<T>(op: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await op();
    } catch (e) {
      lastErr = e;
      if (!CONNECTION_ERROR.test(String(e))) throw e;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr;
}

function buildClient() {
  const base = new PrismaClient();
  return base.$extends({
    query: {
      $allModels: {
        $allOperations({ query, args }) {
          return withRetry(() => query(args));
        },
      },
      // Raw queries (retrieval, dsp) get the same protection.
      $queryRaw({ query, args }) {
        return withRetry(() => query(args));
      },
      $queryRawUnsafe({ query, args }) {
        return withRetry(() => query(args));
      },
      $executeRaw({ query, args }) {
        return withRetry(() => query(args));
      },
      $executeRawUnsafe({ query, args }) {
        return withRetry(() => query(args));
      },
    },
  });
}

type Extended = ReturnType<typeof buildClient>;
const globalForPrisma = globalThis as unknown as { prisma?: Extended };

export const prisma = globalForPrisma.prisma ?? buildClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
