import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { sessionUser } from "@/lib/roles";
import { parseBody } from "@/lib/validate";
import { createCheckoutLink } from "@/lib/order";
import { logger } from "@/lib/log";

// A line is either a catalog SKU or a custom {title, price} charge (e.g. a $6
// replacement arm). The rep can correct quantities in the revision box first.
const itemSchema = z
  .object({
    sku: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1).optional(),
    price: z.string().trim().optional(),
    quantity: z.number().int().min(1).max(999),
  })
  .refine((i) => i.sku || (i.title && i.price != null), {
    message: "each item needs a sku, or a title + price",
  });

const bodySchema = z.object({
  items: z.array(itemSchema).min(1).max(20),
  note: z.string().trim().max(2000).optional(),
  discount: z
    .object({
      value: z.number().min(0),
      valueType: z.enum(["PERCENTAGE", "FIXED_AMOUNT"]),
      title: z.string().trim().max(120).optional(),
    })
    .refine((d) => d.valueType !== "PERCENTAGE" || d.value <= 100, {
      message: "percentage discount cannot exceed 100",
    })
    .optional(),
});

/**
 * Build a Shopify checkout link for this ticket's customer from rep-confirmed
 * line items, and hand back the one-click invoiceUrl to drop into the reply.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await getCurrentTenant();
  const me = await sessionUser();
  if (!me?.id) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const body = await parseBody(req, bodySchema);
  if (body instanceof NextResponse) return body;

  const ticket = await prisma.ticket.findFirst({
    where: { id, tenantId: tenant.id },
    select: { id: true, customer: { select: { email: true } } },
  });
  if (!ticket) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!ticket.customer.email) {
    return NextResponse.json({ error: "This ticket has no customer email to attach the order to." }, { status: 400 });
  }

  try {
    const result = await createCheckoutLink({
      items: body.items,
      email: ticket.customer.email,
      note: body.note ?? `Concierge order for ticket ${ticket.id}`,
      discount: body.discount,
      tags: ["concierge", `ticket:${ticket.id}`],
    });
    await prisma.auditEvent.create({
      data: {
        tenantId: tenant.id,
        actorId: me.id,
        action: "checkout_link_created",
        entity: `ticket:${ticket.id}`,
        meta: {
          draftOrder: result.name,
          totalPrice: result.totalPrice,
          items: body.items.length,
          discount: body.discount ?? null,
          notFound: result.notFound,
        },
      },
    });
    return NextResponse.json(result);
  } catch (e) {
    logger.error({ err: e, ticketId: ticket.id }, "[order] failed to build checkout link");
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to build the checkout link." }, { status: 502 });
  }
}
