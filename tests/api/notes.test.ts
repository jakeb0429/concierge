import { beforeEach, describe, expect, it, vi } from "vitest";

// Context-note gates: exactly ONE scope (ticket | customer | product), the
// scope target must exist in the session tenant, and a date-only expiry means
// "valid through the end of that day" — stored as end-of-day UTC.
const { prisma, sessionUser, getCurrentTenant } = vi.hoisted(() => ({
  prisma: {
    ticket: { findFirst: vi.fn() },
    customer: { findFirst: vi.fn() },
    productFamily: { findFirst: vi.fn() },
    contextNote: { create: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  sessionUser: vi.fn(),
  getCurrentTenant: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/tenant", () => ({ getCurrentTenant }));
vi.mock("@/lib/roles", () => ({ sessionUser }));

const { POST } = await import("@/app/api/notes/route");

const req = (body: unknown) =>
  new Request("http://localhost:3014/api/notes", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentTenant.mockResolvedValue({ id: "t1", slug: "rheos" });
  sessionUser.mockResolvedValue({ id: "u1", email: "rep@x.com", tenantId: "t1", role: "agent" });
  prisma.auditEvent.create.mockResolvedValue({});
  // Echo back what the route stores so assertions read the persisted shape.
  prisma.contextNote.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "n1",
    body: data.body,
    expiresAt: data.expiresAt,
  }));
});

describe("POST /api/notes", () => {
  it("rejects a note with zero scopes (400)", async () => {
    const res = await POST(req({ body: "unscoped" }));
    expect(res.status).toBe(400);
    expect(prisma.contextNote.create).not.toHaveBeenCalled();
  });

  it("rejects a note with two scopes (400)", async () => {
    const res = await POST(req({ body: "double", ticketId: "tk1", customerId: "c1" }));
    expect(res.status).toBe(400);
    expect(prisma.contextNote.create).not.toHaveBeenCalled();
  });

  it("normalizes a date-only expiresAt to end-of-day UTC", async () => {
    prisma.ticket.findFirst.mockResolvedValue({ id: "tk1" });
    const res = await POST(req({ body: "back in stock ~Aug 1", ticketId: "tk1", expiresAt: "2026-08-01" }));
    expect(res.status).toBe(200);
    const stored = prisma.contextNote.create.mock.calls[0][0].data.expiresAt as Date;
    expect(stored.toISOString()).toBe("2026-08-01T23:59:59.000Z");
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "note_added",
        entity: "ticket:tk1",
        meta: { noteId: "n1", expiresAt: "2026-08-01T23:59:59.000Z" },
      }),
    });
  });

  it("creates a ticket-scoped note when the ticket is in the session tenant", async () => {
    prisma.ticket.findFirst.mockResolvedValue({ id: "tk1" });
    const res = await POST(req({ body: "  customer prefers email  ", ticketId: "tk1" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.note).toMatchObject({ id: "n1", body: "customer prefers email", ticketId: "tk1" });
    expect(prisma.ticket.findFirst).toHaveBeenCalledWith({
      where: { id: "tk1", tenantId: "t1" },
      select: { id: true },
    });
    expect(prisma.contextNote.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: "t1", ticketId: "tk1", expiresAt: null, createdBy: "u1" }),
    });
  });
});
