import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { parseBody } from "@/lib/validate";
import { identityCluster, linkCustomers, unlinkCustomer } from "@/lib/customer-links";

/**
 * Associated customer profiles.
 *   GET                          → the cluster this profile belongs to
 *   POST {customerId} or {email} → associate another profile with this one
 *   DELETE {customerId}          → detach that profile from the cluster
 */

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await getCurrentTenant();
  const customer = await prisma.customer.findFirst({ where: { id, tenantId: tenant.id }, select: { id: true } });
  if (!customer) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(await identityCluster(id));
}

const postSchema = z
  .object({ customerId: z.string().optional(), email: z.string().email().optional() })
  .refine((b) => b.customerId || b.email, { message: "customerId or email required" });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseBody(req, postSchema);
  if (parsed instanceof NextResponse) return parsed;
  const tenant = await getCurrentTenant();
  const customer = await prisma.customer.findFirst({ where: { id, tenantId: tenant.id }, select: { id: true } });
  if (!customer) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let otherId = parsed.customerId ?? null;
  if (!otherId && parsed.email) {
    const email = parsed.email.toLowerCase();
    // Associating an email nobody has a profile for yet: create the shell
    // profile so future tickets from that address land in this cluster.
    const other = await prisma.customer.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email } },
      update: {},
      create: { tenantId: tenant.id, email },
      select: { id: true },
    });
    otherId = other.id;
  }
  try {
    await linkCustomers(tenant.id, id, otherId!);
  } catch {
    return NextResponse.json({ error: "Profile not found in this brand." }, { status: 404 });
  }
  return NextResponse.json(await identityCluster(id));
}

const deleteSchema = z.object({ customerId: z.string().min(1) });

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseBody(req, deleteSchema);
  if (parsed instanceof NextResponse) return parsed;
  const tenant = await getCurrentTenant();
  const customer = await prisma.customer.findFirst({ where: { id, tenantId: tenant.id }, select: { id: true } });
  if (!customer) return NextResponse.json({ error: "Not found." }, { status: 404 });
  try {
    await unlinkCustomer(tenant.id, parsed.customerId);
  } catch {
    return NextResponse.json({ error: "Profile not found in this brand." }, { status: 404 });
  }
  return NextResponse.json(await identityCluster(id));
}
