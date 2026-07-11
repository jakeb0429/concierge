import { beforeEach, describe, expect, it, vi } from "vitest";

// "Did you miss this?" resolution gates: schema-validated action, tenant-
// scoped lookup (a foreign ticket 404s), only flagged tickets are actionable,
// and restore both reopens the ticket and re-inboxes the Gmail thread. The
// provider sync is mocked — no Gmail call can leave this file.
const { prisma, sessionUser, getCurrentTenant, syncUnarchiveToProvider } = vi.hoisted(() => ({
  prisma: {
    ticket: { findFirst: vi.fn(), update: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  sessionUser: vi.fn(),
  getCurrentTenant: vi.fn(),
  syncUnarchiveToProvider: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/tenant", () => ({ getCurrentTenant }));
vi.mock("@/lib/roles", () => ({ sessionUser }));
vi.mock("@/lib/archive", () => ({ syncUnarchiveToProvider }));

const { POST } = await import("@/app/api/tickets/[id]/missed/route");

const req = (body: unknown) =>
  new Request("http://localhost:3014/api/tickets/tk1/missed", { method: "POST", body: JSON.stringify(body) });
const params = { params: Promise.resolve({ id: "tk1" }) };

const flaggedTicket = {
  id: "tk1",
  tenantId: "t1",
  status: "archived",
  tags: ["warranty", "gmail_archived", "missed_archive"],
};

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentTenant.mockResolvedValue({ id: "t1", slug: "rheos" });
  sessionUser.mockResolvedValue({ id: "rep1", email: "rep@x.com", tenantId: "t1", role: "agent" });
  prisma.ticket.update.mockResolvedValue({ id: "tk1" });
  prisma.auditEvent.create.mockResolvedValue({});
  syncUnarchiveToProvider.mockResolvedValue(true);
});

describe("POST /api/tickets/[id]/missed", () => {
  it("rejects an unknown action with 400 before touching the DB", async () => {
    const res = await POST(req({ action: "delete" }), params);
    expect(res.status).toBe(400);
    expect(prisma.ticket.findFirst).not.toHaveBeenCalled();
  });

  it("404s on a ticket outside the session tenant", async () => {
    prisma.ticket.findFirst.mockResolvedValue(null); // scoped query finds nothing
    const res = await POST(req({ action: "restore" }), params);
    expect(res.status).toBe(404);
    expect(prisma.ticket.findFirst).toHaveBeenCalledWith({ where: { id: "tk1", tenantId: "t1" } });
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it("400s on a ticket that is not flagged", async () => {
    prisma.ticket.findFirst.mockResolvedValue({ ...flaggedTicket, tags: ["warranty"] });
    const res = await POST(req({ action: "dismiss" }), params);
    expect(res.status).toBe(400);
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it("restore reopens the ticket, clears both marks, and re-inboxes the thread", async () => {
    prisma.ticket.findFirst.mockResolvedValue(flaggedTicket);
    const res = await POST(req({ action: "restore" }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, action: "restore", providerRestored: true });
    expect(prisma.ticket.update).toHaveBeenCalledWith({
      where: { id: "tk1" },
      data: { status: "new", tags: ["warranty"] },
    });
    expect(syncUnarchiveToProvider).toHaveBeenCalledWith("tk1");
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "ticket_missed_restored",
        entity: "ticket:tk1",
        actorId: "rep1",
        meta: { providerRestored: true },
      }),
    });
  });

  it("dismiss clears the warning, keeps provenance, and never touches Gmail", async () => {
    prisma.ticket.findFirst.mockResolvedValue(flaggedTicket);
    const res = await POST(req({ action: "dismiss" }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, action: "dismiss", providerRestored: false });
    // Stays archived; gmail_archived remains as provenance.
    expect(prisma.ticket.update).toHaveBeenCalledWith({
      where: { id: "tk1" },
      data: { tags: ["warranty", "gmail_archived"] },
    });
    expect(syncUnarchiveToProvider).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "ticket_missed_dismissed" }),
    });
  });
});
