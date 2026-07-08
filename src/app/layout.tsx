import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/roles";
import BrandSwitcher from "./BrandSwitcher";
import NavLinks, { type NavItem } from "./NavLinks";
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
  let myTraining = 0;
  if (me?.tenantId) {
    const [tenant, rows, trainingCount] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: me.tenantId } }),
      me.email
        ? prisma.user.findMany({
            where: { email: me.email },
            include: { tenant: { select: { slug: true, name: true } } },
          })
        : Promise.resolve([]),
      me.id
        ? prisma.learningSignal.count({ where: { tenantId: me.tenantId, assigneeId: me.id, status: "open" } })
        : Promise.resolve(0),
    ]);
    tenantName = tenant?.name ?? null;
    currentSlug = tenant?.slug ?? "";
    myBrands = rows.map((r) => r.tenant);
    myTraining = trainingCount;
  }

  const navItems: NavItem[] = [
    { href: "/", label: "Inbox" },
    { href: "/brain", label: "Brand Brain" },
    { href: "/analytics", label: "Analytics" },
    { href: "/reviews", label: "Reviews" },
    { href: "/training", label: "Training", badge: myTraining },
    ...(isAdminRole(me?.role)
      ? [
          { href: "/users", label: "Team" },
          { href: "/sources", label: "Sources" },
        ]
      : []),
  ];

  return (
    <html lang="en">
      <body className="bg-neutral-50 text-neutral-900 antialiased">
        <header className="border-b border-neutral-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-3">
            <Link href="/" className="flex items-center gap-2.5">
              <Image src="/scribe-mark.png" alt="Scribe CHS" width={26} height={26} className="rounded-md" />
              <span className="flex flex-col leading-none">
                <span className="text-[13px] font-bold uppercase tracking-[0.14em] text-gold">Concierge</span>
                <span className="mt-0.5 text-[10px] text-warm-grey">by Scribe CHS</span>
              </span>
            </Link>
            {me && <NavLinks items={navItems} />}
            <span className="ml-auto flex items-center gap-3 text-xs text-warm-grey">
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
