import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  user: { findMany: vi.fn() },
  learningSignal: { groupBy: vi.fn() },
  ticket: { groupBy: vi.fn(), update: vi.fn() },
  auditEvent: { create: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

import { autoAssign, routeSignalAssignee } from "@/lib/assign";

beforeEach(() => {
  vi.clearAllMocks();
  db.ticket.update.mockResolvedValue({});
  db.auditEvent.create.mockResolvedValue({});
});

describe("routeSignalAssignee", () => {
  it("returns null for a null category without querying", async () => {
    expect(await routeSignalAssignee("t1", null)).toBeNull();
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it("returns null when no specialist matches", async () => {
    db.user.findMany.mockResolvedValue([]);
    expect(await routeSignalAssignee("t1", "warranty")).toBeNull();
  });

  it("returns the single specialist without a load query", async () => {
    db.user.findMany.mockResolvedValue([{ id: "u1" }]);
    expect(await routeSignalAssignee("t1", "warranty")).toBe("u1");
    expect(db.learningSignal.groupBy).not.toHaveBeenCalled();
  });

  it("picks the least-loaded specialist by open training questions", async () => {
    db.user.findMany.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
    db.learningSignal.groupBy.mockResolvedValue([
      { assigneeId: "u1", _count: 4 },
      { assigneeId: "u2", _count: 1 },
    ]);
    expect(await routeSignalAssignee("t1", "warranty")).toBe("u2");
  });

  it("treats a specialist absent from the load rows as zero-loaded", async () => {
    db.user.findMany.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
    db.learningSignal.groupBy.mockResolvedValue([{ assigneeId: "u1", _count: 2 }]);
    expect(await routeSignalAssignee("t1", "warranty")).toBe("u2");
  });
});

describe("autoAssign", () => {
  it("returns null for a null category without querying", async () => {
    expect(await autoAssign("t1", "tk1", null)).toBeNull();
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it("leaves the ticket unassigned when no specialist matches", async () => {
    db.user.findMany.mockResolvedValue([]);
    expect(await autoAssign("t1", "tk1", "warranty")).toBeNull();
    expect(db.ticket.update).not.toHaveBeenCalled();
  });

  it("assigns the single specialist, writes the ticket, and audits", async () => {
    db.user.findMany.mockResolvedValue([{ id: "u1", email: "kaitlin@rheosgear.com" }]);
    const result = await autoAssign("t1", "tk1", "warranty");
    expect(result).toEqual({ userId: "u1", email: "kaitlin@rheosgear.com" });
    expect(db.ticket.groupBy).not.toHaveBeenCalled(); // one candidate — no load query
    expect(db.ticket.update).toHaveBeenCalledWith({
      where: { id: "tk1" },
      data: { assigneeId: "u1" },
    });
    expect(db.auditEvent.create).toHaveBeenCalledWith({
      data: {
        tenantId: "t1",
        action: "auto_assigned",
        entity: "ticket:tk1",
        meta: { category: "warranty", assignee: "kaitlin@rheosgear.com" },
      },
    });
  });

  it("picks the least-loaded specialist by open assigned tickets", async () => {
    db.user.findMany.mockResolvedValue([
      { id: "u1", email: "a@rheosgear.com" },
      { id: "u2", email: "b@rheosgear.com" },
    ]);
    db.ticket.groupBy.mockResolvedValue([
      { assigneeId: "u1", _count: 5 },
      { assigneeId: "u2", _count: 2 },
    ]);
    const result = await autoAssign("t1", "tk1", "warranty");
    expect(result).toEqual({ userId: "u2", email: "b@rheosgear.com" });
    expect(db.ticket.update).toHaveBeenCalledWith({
      where: { id: "tk1" },
      data: { assigneeId: "u2" },
    });
  });
});
