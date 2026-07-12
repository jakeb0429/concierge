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
