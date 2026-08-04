import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { parseBody } from "@/lib/validate";
import { linkedOrders, findOrdersByRef, lookupCandidates } from "@/lib/ticket-orders";

/**
 * Ticket↔order links.
 *   GET               → { linked, candidates } (candidates only when ?lookup=1)
 *   POST {ref}        → attach by order # / hull id (404s listing near-misses)
 *   POST {orderId}    → attach a specific candidate from the lookup
 *   DELETE {linkId}   → unlink
 */

async function ticketOr404(id: string) {
  const tenant = await getCurrentTenant();
  const ticket = await prisma.ticket.findFirst({
    where: { id, tenantId: tenant.id },
    select: { id: true, tenantId: true, customerId: true, customer: { select: { displayName: true } } },
  });
  return { tenant, ticket };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tenant, ticket } = await ticketOr404(id);
  if (!ticket) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const linked = await linkedOrders(ticket.id);
  const wantLookup = new URL(req.url).searchParams.get("lookup") === "1";
  const candidates = wantLookup
    ? await lookupCandidates(tenant.id, ticket.customerId, ticket.customer.displayName, linked.map((l) => l.orderId))
    : [];
  return NextResponse.json({ linked, candidates });
}

const postSchema = z
  .object({ ref: z.string().min(2).max(80).optional(), orderId: z.string().optional(), via: z.enum(["manual", "lookup"]).optional() })
  .refine((b) => b.ref || b.orderId, { message: "ref or orderId required" });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseBody(req, postSchema);
  if (parsed instanceof NextResponse) return parsed;
  const { tenant, ticket } = await ticketOr404(id);
  if (!ticket) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let orderId = parsed.orderId ?? null;
  if (!orderId && parsed.ref) {
    const matches = await findOrdersByRef(tenant.id, parsed.ref);
    if (!matches.length)
      return NextResponse.json({ error: `No order found for “${parsed.ref.trim()}”.` }, { status: 404 });
    if (matches.length > 1)
      return NextResponse.json(
        { error: "Multiple orders match — pick one.", matches: matches.map((m) => ({ orderId: m.id, orderRef: m.orderRef, description: m.description, buyerName: m.buyerName })) },
        { status: 409 }
      );
    orderId = matches[0].id;
  }
  // Tenant guard on direct orderId attaches (candidate ids come from our own lookup).
  const order = await prisma.customerOrder.findFirst({ where: { id: orderId!, tenantId: tenant.id }, select: { id: true } });
  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });

  await prisma.ticketOrder.upsert({
    where: { ticketId_customerOrderId: { ticketId: ticket.id, customerOrderId: order.id } },
    update: {},
    create: { tenantId: tenant.id, ticketId: ticket.id, customerOrderId: order.id, via: parsed.via ?? "manual" },
  });
  return NextResponse.json({ linked: await linkedOrders(ticket.id) });
}

const deleteSchema = z.object({ linkId: z.string().min(1) });

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseBody(req, deleteSchema);
  if (parsed instanceof NextResponse) return parsed;
  const { tenant, ticket } = await ticketOr404(id);
  if (!ticket) return NextResponse.json({ error: "Not found." }, { status: 404 });
  await prisma.ticketOrder.deleteMany({
    where: { id: parsed.linkId, ticketId: ticket.id, tenantId: tenant.id },
  });
  return NextResponse.json({ linked: await linkedOrders(ticket.id) });
}
