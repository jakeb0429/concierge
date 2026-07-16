import { describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { customerOrder: { findMany: (...a: unknown[]) => findMany(...a) } } }));

import {
  getRegisteredBoats,
  getRegisteredBoatsByName,
  boatContextLines,
  DEALER_NETWORK_SOURCE,
} from "@/lib/boats";

describe("getRegisteredBoats", () => {
  it("queries dealers-circle rows scoped to the tenant, lowercased email", async () => {
    findMany.mockResolvedValueOnce([]);
    await getRegisteredBoats("  Owner@Example.COM ", "tenant-1");
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: { in: ["owner@example.com"] }, tenantId: "tenant-1", source: DEALER_NETWORK_SOURCE },
      })
    );
  });

  it("accepts a cluster of emails and dedupes them", async () => {
    findMany.mockClear();
    findMany.mockResolvedValueOnce([]);
    await getRegisteredBoats(["a@x.com", "A@X.com", null, "b@x.com"], "tenant-1");
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: { in: ["a@x.com", "b@x.com"] }, tenantId: "tenant-1", source: DEALER_NETWORK_SOURCE },
      })
    );
  });

  it("returns [] for a blank email without querying", async () => {
    findMany.mockClear();
    expect(await getRegisteredBoats("   ", "tenant-1")).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("getRegisteredBoatsByName", () => {
  it("matches every name token order-free ('Matt Shelton' finds 'Shelton, Matt')", async () => {
    findMany.mockClear();
    findMany.mockResolvedValueOnce([]);
    await getRegisteredBoatsByName("Matt Shelton", "tenant-1");
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "tenant-1",
          source: DEALER_NETWORK_SOURCE,
          AND: [
            { buyerName: { contains: "matt", mode: "insensitive" } },
            { buyerName: { contains: "shelton", mode: "insensitive" } },
          ],
        }),
      })
    );
  });

  it("refuses single-token names — too many strangers share a first name", async () => {
    findMany.mockClear();
    expect(await getRegisteredBoatsByName("Melissa", "tenant-1")).toEqual([]);
    expect(await getRegisteredBoatsByName(null, "tenant-1")).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("boatContextLines", () => {
  it("renders the description with the registration date", () => {
    const lines = boatContextLines([
      {
        orderRef: "PNYUS0KRB121",
        orderedAt: new Date("2021-05-22T00:00:00Z"),
        description: "2021 236CC · Hull PNYUS0KRB121 · delivered May 22, 2021 via Memphis Boat Center · original owner",
      },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("2021 236CC");
    expect(lines[0]).toContain("registered");
  });

  it("falls back to the hull ref when description is missing", () => {
    const lines = boatContextLines([
      { orderRef: "PNYUSJM0H020", orderedAt: new Date("2020-09-11T00:00:00Z"), description: null },
    ]);
    expect(lines[0]).toMatch(/^Hull PNYUSJM0H020/);
  });
});
