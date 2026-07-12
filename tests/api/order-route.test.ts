import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/tickets/[id]/order — builds a Shopify checkout link from rep-
// confirmed line items. Money path: bad prices/quantities/discounts must be
// rejected BEFORE the order service is called; audit failures must NOT turn a
// created order into a 502.
const { prisma, getCurrentTenant, sessionUser, createCheckoutLink } = vi.hoisted(() => ({
  prisma: { ticket: { findFirst: vi.fn() }, auditEvent: { create: vi.fn() } },
  getCurrentTenant: vi.fn(),
  sessionUser: vi.fn(),
  createCheckoutLink: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/tenant", () => ({ getCurrentTenant }));
vi.mock("@/lib/roles", () => ({ sessionUser }));
vi.mock("@/lib/order", () => ({ createCheckoutLink }));
vi.mock("@/lib/log", () => ({ logger: { error: vi.fn(), info: vi.fn() } }));

const { POST } = await import("@/app/api/tickets/[id]/order/route");

const req = (body: unknown) =>
  new Request("http://localhost:3014/api/tickets/tk1/order", { method: "POST", body: JSON.stringify(body) });
const params = { params: Promise.resolve({ id: "tk1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentTenant.mockResolvedValue({ id: "t1" });
  sessionUser.mockResolvedValue({ id: "rep1", email: "rep@x.com" });
  prisma.ticket.findFirst.mockResolvedValue({ id: "tk1", customer: { email: "kris@x.com" } });
  prisma.auditEvent.create.mockResolvedValue({});
  createCheckoutLink.mockResolvedValue({ invoiceUrl: "https://x/invoices/abc", name: "#D1", totalPrice: "74.12", notFound: [] });
});

describe("POST /api/tickets/[id]/order", () => {
  it("401 when not signed in", async () => {
    sessionUser.mockResolvedValue(null);
    const res = await POST(req({ items: [{ sku: "A", quantity: 1 }] }), params);
    expect(res.status).toBe(401);
    expect(createCheckoutLink).not.toHaveBeenCalled();
  });

  it("rejects a negative custom price before hitting the order service", async () => {
    const res = await POST(req({ items: [{ title: "Arm", price: "-50.00", quantity: 1 }] }), params);
    expect(res.status).toBe(400);
    expect(createCheckoutLink).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric price", async () => {
    const res = await POST(req({ items: [{ title: "Arm", price: "abc", quantity: 1 }] }), params);
    expect(res.status).toBe(400);
    expect(createCheckoutLink).not.toHaveBeenCalled();
  });

  it("rejects a percentage discount over 100", async () => {
    const res = await POST(req({ items: [{ sku: "A", quantity: 1 }], discount: { value: 150, valueType: "PERCENTAGE" } }), params);
    expect(res.status).toBe(400);
    expect(createCheckoutLink).not.toHaveBeenCalled();
  });

  it("404s a ticket outside the session tenant", async () => {
    prisma.ticket.findFirst.mockResolvedValue(null);
    const res = await POST(req({ items: [{ sku: "A", quantity: 1 }] }), params);
    expect(res.status).toBe(404);
    expect(createCheckoutLink).not.toHaveBeenCalled();
  });

  it("builds the link for the ticket's customer and audits it", async () => {
    const res = await POST(
      req({ items: [{ sku: "13039-00110", quantity: 1 }, { title: "Replacement arm", price: "6.00", quantity: 2 }], discount: { value: 20, valueType: "PERCENTAGE" } }),
      params,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).invoiceUrl).toBe("https://x/invoices/abc");
    expect(createCheckoutLink).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "kris@x.com", // the ticket's customer, not attacker-supplied
        items: expect.arrayContaining([{ sku: "13039-00110", quantity: 1 }]),
        discount: { value: 20, valueType: "PERCENTAGE" },
      }),
    );
    const actions = prisma.auditEvent.create.mock.calls.map((c) => c[0].data.action);
    expect(actions).toContain("checkout_link_created");
  });

  it("still returns the created order when the audit write fails (no misleading 502)", async () => {
    prisma.auditEvent.create.mockRejectedValue(new Error("pooler blip"));
    const res = await POST(req({ items: [{ sku: "A", quantity: 1 }] }), params);
    expect(res.status).toBe(200);
    expect((await res.json()).invoiceUrl).toBe("https://x/invoices/abc");
  });
});
