import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { unstable_cache } from "next/cache";
import { cookies } from "next/headers";
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
  let myQuestions = 0;
  let preferredView = "full";
  if (me?.tenantId) {
    // Tenant identity + brand memberships almost never change but were paying
    // a cross-continent DB round trip on EVERY page — cache 60s. The training
    // badge stays fresher (30s) since specialists watch it.
    const getChrome = unstable_cache(
      async (tenantId: string, email: string) => {
        const [tenant, rows, viewer] = await Promise.all([
          prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, slug: true } }),
          email
            ? prisma.user.findMany({ where: { email }, select: { tenant: { select: { slug: true, name: true } } } })
            : Promise.resolve([]),
          email
            ? prisma.user.findFirst({ where: { tenantId, email }, select: { preferredView: true } })
            : Promise.resolve(null),
        ]);
        return { tenant, brands: rows.map((r) => r.tenant), preferredView: viewer?.preferredView ?? "full" };
      },
      ["layout-chrome"],
      { revalidate: 60 }
    );
    const getBadges = unstable_cache(
      async (tenantId: string, userId: string) =>
        Promise.all([
          prisma.learningSignal.count({ where: { tenantId, assigneeId: userId, status: "open" } }),
          prisma.ticketQuestion.count({ where: { tenantId, assigneeId: userId, status: "open" } }),
        ]),
      ["layout-badges"],
      { revalidate: 30 }
    );
    const [chrome, [trainingCount, questionCount]] = await Promise.all([
      getChrome(me.tenantId, me.email ?? ""),
      me.id ? getBadges(me.tenantId, me.id) : Promise.resolve([0, 0] as [number, number]),
    ]);
    tenantName = chrome.tenant?.name ?? null;
    currentSlug = chrome.tenant?.slug ?? "";
    myBrands = chrome.brands;
    myTraining = trainingCount;
    myQuestions = questionCount;
    preferredView = chrome.preferredView;
  }

  // The Simple (Q&A) view: minimal nav for teammates who only answer internal
  // questions. Cookie (set by the header toggle) overrides the stored default.
  const cookieView = (await cookies()).get("concierge-view")?.value;
  const view = cookieView === "simple" || cookieView === "full" ? cookieView : preferredView;

  const navItems: NavItem[] =
    view === "simple"
      ? [{ href: "/questions", label: "Questions", badge: myQuestions }]
      : [
          { href: "/", label: "Inbox" },
          { href: "/questions", label: "Questions", badge: myQuestions },
          { href: "/brain", label: "Brand Brain" },
          { href: "/analytics", label: "Analytics" },
          { href: "/reviews", label: "Reviews" },
          { href: "/training", label: "Training", badge: myTraining },
          ...(isAdminRole(me?.role)
            ? [
                { href: "/digest", label: "Digest" },
                { href: "/users", label: "Team" },
                { href: "/sources", label: "Sources" },
                { href: "/audit", label: "Audit" },
              ]
            : []),
        ];

  return (
    <html lang="en">
      <body className="bg-neutral-50 text-neutral-900 antialiased">
        <header className="border-b border-neutral-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center gap-6 overflow-x-auto px-6 py-3">
            <Link href="/" className="flex items-center gap-2.5">
              <Image src="/scribe-mark.png" alt="Scribe CHS" width={26} height={26} className="rounded-md" />
              <span className="flex flex-col leading-none">
                <span className="text-[13px] font-bold uppercase tracking-[0.14em] text-gold">Concierge</span>
                <span className="mt-0.5 text-[10px] text-warm-grey">by Scribe CHS</span>
              </span>
            </Link>
            {me && <NavLinks items={navItems} />}
            <span className="ml-auto flex items-center gap-3 text-xs text-warm-grey">
              {me && (
                <form action={`/view/${view === "simple" ? "full" : "simple"}`} method="post">
                  <button
                    type="submit"
                    className="rounded-full border border-neutral-200 px-2.5 py-1 hover:bg-neutral-50"
                    title={view === "simple" ? "Open the full workspace" : "Switch to the simple Q&A view"}
                  >
                    {view === "simple" ? "Full view" : "Simple view"}
                  </button>
                </form>
              )}
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
