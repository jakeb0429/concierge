import { unstable_cache } from "next/cache";
import { prisma } from "./db";

/**
 * Tenant roster + mailbox lists, cached 60s. These render on every inbox
 * and ticket page (assignee dropdowns, mailbox filter) but change only when
 * someone edits the team — not worth a 175ms DB round trip per view.
 * String-only selects, so the cache's JSON round trip is lossless.
 */
export const cachedTenantUsers = unstable_cache(
  async (tenantId: string) =>
    prisma.user.findMany({
      where: { tenantId },
      select: { id: true, email: true, name: true },
      orderBy: { email: "asc" },
    }),
  ["tenant-users"],
  { revalidate: 60 }
);

export const cachedMailboxes = unstable_cache(
  async (tenantId: string) =>
    prisma.channel.findMany({
      where: { tenantId },
      select: { supportAddress: true },
      orderBy: { supportAddress: "asc" },
    }),
  ["tenant-mailboxes"],
  { revalidate: 60 }
);
