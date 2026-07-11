import { beforeEach, describe, expect, it, vi } from "vitest";

// Ticket PATCH gates: schema-validated status, tenant-scoped lookup (a foreign
// ticket 404s, never leaks), and an audit row on every change. The provider
// archive sync is mocked — no Gmail call can leave this file.
const { prisma, sessionUser, getCurrentTenant, syncArchiveToProvider } = vi.hoisted(() => ({
  prisma: {
    ticket: { findFirst: vi.fn(), update: vi.fn() },
    user: { findFirst: vi.fn() },
    contextNote: { create: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  sessionUser: vi.fn(),
  getCurrentTenant: vi.fn(),
  syncArchiveToProvider: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/tenant", () => ({ getCurrentTenant }));
vi.mock("@/lib/roles", () => ({ sessionUser }));
vi.mock("@/lib/archive", () => ({ syncArchiveToProvider }));

const { PATCH } = await import("@/app/api/tickets/[id]/route");

const req = (body: unknown) =>
  new Request("http://localhost:3014/api/tickets/tk1", { method: "PATCH", body: JSON.stringify(body) });
const params = { params: Promise.resolve({ id: "tk1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentTenant.mockResolvedValue({ id: "t1", slug: "rheos" });
  sessionUser.mockResolvedValue({ id: "adm1", email: "adm@x.com", tenantId: "t1", role: "brand_admin" });
  prisma.auditEvent.create.mockResolvedValue({});
  syncArchiveToProvider.mockResolvedValue(false);
});

describe("PATCH /api/tickets/[id]", () => {
  it("rejects an invalid status with 400 before touching the DB", async () => {
    const res = await PATCH(req({ status: "drafted" }), params); // system-set, not rep-settable
    expect(res.status).toBe(400);
    expect(prisma.ticket.findFirst).not.toHaveBeenCalled();
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it("404s on a ticket outside the session tenant", async () => {
    prisma.ticket.findFirst.mockResolvedValue(null); // scoped query finds nothing
    const res = await PATCH(req({ status: "resolved" }), params);
    expect(res.status).toBe(404);
    expect(prisma.ticket.findFirst).toHaveBeenCalledWith({ where: { id: "tk1", tenantId: "t1" } });
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it("rejects an out-of-scale priority with 400 before touching the DB", async () => {
    const res = await PATCH(req({ priority: "vip" }), params); // pre-2026-07-11 value, retired
    expect(res.status).toBe(400);
    expect(prisma.ticket.findFirst).not.toHaveBeenCalled();
  });

  it("reprioritizes (the triage-over-flagged corrective) and audits from→to", async () => {
    prisma.ticket.findFirst.mockResolvedValue({ id: "tk1", tenantId: "t1", priority: "urgent", assigneeId: null, category: "replacement_parts" });
    prisma.ticket.update.mockResolvedValue({ id: "tk1" });
    const res = await PATCH(req({ priority: "normal" }), params);
    expect(res.status).toBe(200);
    expect(prisma.ticket.update).toHaveBeenCalledWith({ where: { id: "tk1" }, data: { priority: "normal" } });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "ticket_reprioritized",
        entity: "ticket:tk1",
        meta: { fromPriority: "urgent", toPriority: "normal" },
      }),
    });
    expect(syncArchiveToProvider).not.toHaveBeenCalled();
  });

  it("resolves with a note — the off-channel record lands as a ticket note + audit meta", async () => {
    prisma.ticket.findFirst.mockResolvedValue({ id: "tk1", tenantId: "t1", status: "new" });
    prisma.ticket.update.mockResolvedValue({ id: "tk1" });
    prisma.contextNote.create.mockResolvedValue({ id: "n1" });
    const res = await PATCH(req({ status: "resolved", note: "Customer called — resolved by phone, replacement shipped." }), params);
    expect(res.status).toBe(200);
    expect(prisma.ticket.update).toHaveBeenCalledWith({ where: { id: "tk1" }, data: { status: "resolved" } });
    expect(prisma.contextNote.create).toHaveBeenCalledWith({
      data: {
        tenantId: "t1",
        ticketId: "tk1",
        body: "Customer called — resolved by phone, replacement shipped.",
        createdBy: "adm1",
      },
    });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "ticket_resolved",
        meta: expect.objectContaining({ note: "Customer called — resolved by phone, replacement shipped." }),
      }),
    });
  });

  it("a note alone is not an update — 400, and no orphan note is written", async () => {
    prisma.ticket.findFirst.mockResolvedValue({ id: "tk1", tenantId: "t1", status: "new" });
    const res = await PATCH(req({ note: "just a note" }), params);
    expect(res.status).toBe(400);
    expect(prisma.contextNote.create).not.toHaveBeenCalled();
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it("reassigns to a tenant teammate and writes the audit trail", async () => {
    prisma.ticket.findFirst.mockResolvedValue({ id: "tk1", tenantId: "t1", assigneeId: "u1", category: "warranty" });
    prisma.user.findFirst.mockResolvedValue({ id: "u2", tenantId: "t1" });
    prisma.ticket.update.mockResolvedValue({ id: "tk1" });
    const res = await PATCH(req({ assigneeId: "u2" }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, assigneeId: "u2", providerArchived: false });
    // The new assignee must exist in THIS tenant.
    expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { id: "u2", tenantId: "t1" } });
    expect(prisma.ticket.update).toHaveBeenCalledWith({ where: { id: "tk1" }, data: { assigneeId: "u2" } });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "ticket_reassigned",
        entity: "ticket:tk1",
        actorId: "adm1",
        meta: { from: "u1", to: "u2" },
      }),
    });
    expect(syncArchiveToProvider).not.toHaveBeenCalled(); // only archive syncs to the mailbox
  });
});
