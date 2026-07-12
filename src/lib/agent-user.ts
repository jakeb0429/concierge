import { prisma } from "./db";

/**
 * The per-tenant system identity that asks auto-escalated questions ("the
 * agent didn't know, so it asked a teammate"). Passwordless with no magic
 * token, so it can never sign in. Created lazily + idempotently the first
 * time the escalation loop needs it. Reply-route logic identifies an
 * agent-asked question by comparing TicketQuestion.askedById to this id.
 */
export const AGENT_USER_EMAIL = "agent@concierge.internal";
export const AGENT_USER_NAME = "Concierge Agent";

export async function getAgentUser(
  tenantId: string
): Promise<{ id: string; email: string; name: string | null }> {
  return prisma.user.upsert({
    where: { tenantId_email: { tenantId, email: AGENT_USER_EMAIL } },
    update: {},
    create: { tenantId, email: AGENT_USER_EMAIL, name: AGENT_USER_NAME, role: "agent" },
    select: { id: true, email: true, name: true },
  });
}

/**
 * Read-only lookup for the agent identity — no write. Use on hot read paths
 * (e.g. every draft POST) so we don't run a user.upsert per request. Returns
 * null before the bot has ever been created (i.e. before the first escalation);
 * callers treat that as "no agent questions exist yet." The upserting
 * getAgentUser stays the single writer, called only when actually escalating.
 */
export async function findAgentUser(
  tenantId: string
): Promise<{ id: string; email: string; name: string | null } | null> {
  return prisma.user.findUnique({
    where: { tenantId_email: { tenantId, email: AGENT_USER_EMAIL } },
    select: { id: true, email: true, name: true },
  });
}
