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
import Sidebar, { type NavGroup } from "./Sidebar";
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
    // a cross-continent DB round trip on EVERY page — cache 60s. The badges
    // stay fresher (30s) since specialists watch them.
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

  // The Simple (Q&A) view: minimal chrome for teammates who only answer
  // internal questions. Cookie (set by the header toggle) overrides the
  // stored default.
  const cookieView = (await cookies()).get("concierge-view")?.value;
  const view = cookieView === "simple" || cookieView === "full" ? cookieView : preferredView;
  const admin = isAdminRole(me?.role);

  // WORK is the daily loop; KNOWLEDGE feeds the Brain; INSIGHT reports.
  // Team/Audit are reference, not work — they sink to the rail footer.
  const groups: NavGroup[] = [
    {
      label: "Work",
      items: [
        { href: "/", label: "Inbox" },
        { href: "/questions", label: "Questions", badge: myQuestions },
        { href: "/reviews", label: "Reviews" },
      ],
    },
    {
      label: "Knowledge",
      items: [
        { href: "/brain", label: "Brand Brain" },
        { href: "/training", label: "Training", badge: myTraining },
        ...(admin ? [{ href: "/sources", label: "Sources" }] : []),
      ],
    },
    {
      label: "Insight",
      items: [
        { href: "/analytics", label: "Analytics" },
        ...(admin ? [{ href: "/digest", label: "Digest" }] : []),
      ],
    },
  ];
  const footerItems: NavItem[] = admin
    ? [
        { href: "/users", label: "Team" },
        { href: "/audit", label: "Audit" },
      ]
    : [];
  // The flat list serves the mobile top bar (and stays the Simple view's nav).
  const flatItems: NavItem[] =
    view === "simple"
      ? [{ href: "/questions", label: "Questions", badge: myQuestions }]
      : [...groups.flatMap((g) => g.items), ...footerItems];

  const viewToggle = me && (
    <form action={`/view/${view === "simple" ? "full" : "simple"}`} method="post">
      <button
        type="submit"
        className="rounded-full border border-neutral-200 px-2.5 py-1 text-xs text-warm-grey hover:bg-neutral-50"
        title={view === "simple" ? "Open the full workspace" : "Switch to the simple Q&A view"}
      >
        {view === "simple" ? "Full view" : "Simple view"}
      </button>
    </form>
  );

  const topBar = (
    <header className={`border-b border-neutral-200 bg-white ${me && view !== "simple" ? "lg:hidden" : ""}`}>
      <div className="mx-auto flex max-w-5xl items-center gap-6 overflow-x-auto px-6 py-3">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <Image src="/scribe-mark.png" alt="Scribe CHS" width={26} height={26} className="rounded-md" />
          <span className="flex flex-col leading-none">
            <span className="text-[13px] font-bold uppercase tracking-[0.14em] text-gold">Concierge</span>
            <span className="mt-0.5 text-[10px] text-warm-grey">by Scribe CHS</span>
          </span>
        </Link>
        {me && <NavLinks items={flatItems} />}
        <span className="ml-auto flex shrink-0 items-center gap-3 text-xs text-warm-grey">
          {viewToggle}
          {myBrands.length > 1 ? (
            <BrandSwitcher current={currentSlug} tenants={myBrands} />
          ) : (
            tenantName && <span>{tenantName}</span>
          )}
          {me?.email && <span className="hidden sm:inline">{me.email}</span>}
        </span>
      </div>
    </header>
  );

  // Simple view (and signed-out pages): the slim top bar is the whole chrome.
  if (!me || view === "simple") {
    return (
      <html lang="en">
        <body className="bg-neutral-50 text-neutral-900 antialiased">
          {topBar}
          <main className={`mx-auto px-6 py-8 ${view === "simple" && me ? "max-w-3xl" : "max-w-5xl"}`}>{children}</main>
        </body>
      </html>
    );
  }

  // Full workspace: left rail at lg+, the top bar below it.
  return (
    <html lang="en">
      <body className="bg-neutral-50 text-neutral-900 antialiased">
        <div className="flex min-h-screen">
          <Sidebar groups={groups} footerItems={footerItems} tenantName={tenantName}>
            {viewToggle}
            {myBrands.length > 1 ? (
              <BrandSwitcher current={currentSlug} tenants={myBrands} />
            ) : null}
            {me.email && <span className="truncate text-[11px]">{me.email}</span>}
          </Sidebar>
          <div className="min-w-0 flex-1">
            {topBar}
            <main className="max-w-[1200px] px-6 py-6 lg:px-8">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
