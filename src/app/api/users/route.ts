import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { requireAdmin } from "@/lib/roles";
import { INQUIRY_CATEGORIES } from "@/lib/categories";

const ASSIGNABLE_ROLES = new Set(["agent", "team_lead", "brand_admin"]);

function validSpecialties(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const set = new Set(INQUIRY_CATEGORIES as readonly string[]);
  return input.every((s) => typeof s === "string" && set.has(s)) ? input : null;
}

/** Add a teammate. The User row IS the sign-in grant (magic link). */
export async function POST(req: Request) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }
  const tenant = await getCurrentTenant();
  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    name?: string;
    role?: string;
    specialties?: unknown;
  };
  const email = (body.email ?? "").toLowerCase().trim();
  if (!email.includes("@")) return NextResponse.json({ error: "Valid email required." }, { status: 400 });
  const role = body.role ?? "agent";
  if (!ASSIGNABLE_ROLES.has(role)) return NextResponse.json({ error: "Invalid role." }, { status: 400 });
  const specialties = validSpecialties(body.specialties ?? []);
  if (!specialties) return NextResponse.json({ error: "Invalid specialties." }, { status: 400 });

  const user = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email } },
    update: { name: body.name || undefined, role, specialties },
    create: { tenantId: tenant.id, email, name: body.name || null, role, specialties },
  });
  await prisma.auditEvent.create({
    data: { tenantId: tenant.id, action: "user_provisioned", entity: `user:${user.id}`, meta: { email, role, specialties } },
  });
  return NextResponse.json({ ok: true, id: user.id });
}
