"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import type { NavItem } from "./NavLinks";

export type NavGroup = { label: string | null; items: NavItem[] };

/**
 * The full-workspace left rail (lg+). Groups keep ten destinations calm:
 * WORK is the daily loop, KNOWLEDGE feeds the Brain, INSIGHT reports, and
 * admin reference (Team/Audit) sinks to the footer with identity. Active
 * item wears the cream fill + gold spine — the ticket page's zone-band
 * gesture, quoted by the chrome.
 */
export default function Sidebar({
  groups,
  footerItems,
  tenantName,
  children,
}: {
  groups: NavGroup[];
  footerItems: NavItem[];
  tenantName: string | null;
  children?: React.ReactNode; // identity block: view toggle, brand switcher, email
}) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-neutral-200 bg-white lg:flex">
      {/* identity block — the one place cream is a surface */}
      <Link href="/" className="flex items-center gap-2.5 border-b border-neutral-200 bg-cream px-4 py-4">
        <Image src="/scribe-mark.png" alt="Scribe CHS" width={26} height={26} className="rounded-md" />
        <span className="flex min-w-0 flex-col leading-none">
          <span className="text-[13px] font-bold uppercase tracking-[0.14em] text-gold">Concierge</span>
          <span className="mt-0.5 truncate text-[10px] text-warm-grey">
            {tenantName ? `${tenantName} · by Scribe CHS` : "by Scribe CHS"}
          </span>
        </span>
      </Link>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {groups.map((g) => (
          <div key={g.label ?? "top"}>
            {g.label && <div className="nav-group-label">{g.label}</div>}
            {g.items.map((it) => (
              <Link key={it.href} href={it.href} className={`nav-item ${isActive(it.href) ? "nav-item-active" : ""}`}>
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                {it.badge ? <span className="nav-badge">{it.badge}</span> : null}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="border-t border-neutral-100 px-2 py-3">
        {footerItems.length > 0 && (
          <div className="mb-2">
            {footerItems.map((it) => (
              <Link key={it.href} href={it.href} className={`nav-item ${isActive(it.href) ? "nav-item-active" : ""}`}>
                {it.label}
              </Link>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-2 px-3 text-xs text-warm-grey">{children}</div>
      </div>
    </aside>
  );
}
