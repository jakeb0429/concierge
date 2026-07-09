import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { sessionUser } from "@/lib/roles";

/**
 * Add a context note — scoped to one ticket OR to the customer. Optional
 * expiration (e.g. "back in stock when PO260501 arrives ~Aug 1"): after that
 * date the note stops feeding drafts and queues for admin review.
 * Body: { body, ticketId? | customerId?, expiresAt? (ISO date) }
 */
export async function POST(req: Request) {
  const tenant = await getCurrentTenant();
  const actor = await sessionUser();
  const { body, ticketId, customerId, productFamily, expiresAt } = (await req.json().catch(() => ({}))) as {
    body?: string;
    ticketId?: string;
    customerId?: string;
    productFamily?: string;
    expiresAt?: string | null;
  };
  if (!body?.trim()) return NextResponse.json({ error: "The note text is required." }, { status: 400 });
  const scopes = [ticketId, customerId, productFamily].filter(Boolean).length;
  if (scopes !== 1)
    return NextResponse.json({ error: "Scope the note to a ticket, a customer, OR a product." }, { status: 400 });

  if (ticketId) {
    const t = await prisma.ticket.findFirst({ where: { id: ticketId, tenantId: tenant.id }, select: { id: true } });
    if (!t) return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  } else if (customerId) {
    const c = await prisma.customer.findFirst({ where: { id: customerId, tenantId: tenant.id }, select: { id: true } });
    if (!c) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  } else if (productFamily) {
    const f = await prisma.productFamily.findFirst({ where: { name: { equals: productFamily, mode: "insensitive" } } });
    if (!f) return NextResponse.json({ error: `Unknown product family "${productFamily}".` }, { status: 404 });
  }
  // A date-only expiry means "valid through the end of that day" — store
  // end-of-day UTC so it doesn't expire (or display) a day early in ET.
  const expires = expiresAt
    ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(expiresAt) ? `${expiresAt}T23:59:59.000Z` : expiresAt)
    : null;
  if (expires && isNaN(expires.getTime()))
    return NextResponse.json({ error: "Invalid expiration date." }, { status: 400 });

  const note = await prisma.contextNote.create({
    data: {
      tenantId: tenant.id,
      ticketId: ticketId ?? null,
      customerId: customerId ?? null,
      productFamily: productFamily ?? null,
      body: body.trim(),
      expiresAt: expires,
      createdBy: actor?.id ?? null,
    },
  });
  await prisma.auditEvent.create({
    data: {
      tenantId: tenant.id,
      actorId: actor?.id,
      action: "note_added",
      entity: ticketId ? `ticket:${ticketId}` : customerId ? `customer:${customerId}` : `product:${productFamily}`,
      meta: { noteId: note.id, expiresAt: expires?.toISOString() ?? null },
    },
  });
  return NextResponse.json({
    note: { id: note.id, body: note.body, expiresAt: note.expiresAt, ticketId, customerId, productFamily },
  });
}
