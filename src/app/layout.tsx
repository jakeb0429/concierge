import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/roles";
import BrandSwitcher from "./BrandSwitcher";
import "./globals.css";

export const metadata: Metadata = {
  title: "Concierge",
  description: "Knowledge-grounded, AI-drafted, human-confirmed customer service.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth().catch(() => null);
  const me = session?.user ?? null;

  let tenantName: string | null = null;
  let myBrands: { slug: string; name: string }[] = [];
  let currentSlug = "";
  if (me?.tenantId) {
    const [tenant, rows] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: me.tenantId } }),
      me.email
        ? prisma.user.findMany({
            where: { email: me.email },
            include: { tenant: { select: { slug: true, name: true } } },
          })
        : Promise.resolve([]),
    ]);
    tenantName = tenant?.name ?? null;
    currentSlug = tenant?.slug ?? "";
    myBrands = rows.map((r) => r.tenant);
  }

  return (
    <html lang="en">
      <body className="bg-neutral-50 text-neutral-900 antialiased">
        <header className="border-b border-neutral-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-3">
            <Link href="/" className="font-semibold tracking-tight">
              Concierge
            </Link>
            <nav className="flex gap-4 text-sm text-neutral-500">
              <Link href="/" className="hover:text-neutral-900">
                Inbox
              </Link>
              <Link href="/brain" className="hover:text-neutral-900">
                Brand Brain
              </Link>
              <Link href="/analytics" className="hover:text-neutral-900">
                Analytics
              </Link>
              <Link href="/reviews" className="hover:text-neutral-900">
                Reviews
              </Link>
              {isAdminRole(me?.role) && (
                <Link href="/users" className="hover:text-neutral-900">
                  Team
                </Link>
              )}
            </nav>
            <span className="ml-auto flex items-center gap-3 text-xs text-neutral-400">
              {myBrands.length > 1 ? (
                <BrandSwitcher current={currentSlug} tenants={myBrands} />
              ) : (
                tenantName && <span>{tenantName}</span>
              )}
              {me?.email && <span>{me.email}</span>}
            </span>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
