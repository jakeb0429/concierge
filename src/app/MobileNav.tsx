"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "./NavLinks";
import type { NavGroup } from "./Sidebar";

/**
 * The small-screen menu (full workspace, <lg): a hamburger opening the same
 * grouped nav the rail shows — groups, badges, admin refs, identity — instead
 * of ten items shoulder-to-shoulder in a scroll strip. Closes itself on
 * navigation; the burger wears the combined badge so "you have work" survives
 * the fold.
 */
export default function MobileNav({
  groups,
  footerItems,
  children,
}: {
  groups: NavGroup[];
  footerItems: NavItem[];
  children?: React.ReactNode; // identity block: view toggle, brand switcher, email
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const close = () => setOpen(false); // every link click closes the sheet
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const badgeTotal = groups.flatMap((g) => g.items).reduce((s, it) => s + (it.badge ?? 0), 0);

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        className="relative ml-auto rounded-md border border-neutral-200 p-2 text-neutral-600 hover:bg-neutral-50"
      >
        {open ? (
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
            <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
            <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        )}
        {badgeTotal > 0 && !open && <span className="nav-badge absolute -right-1.5 -top-1.5">{badgeTotal}</span>}
      </button>

      {open && (
        <div className="absolute inset-x-0 top-full z-40 border-b border-neutral-200 bg-white px-4 pb-4">
          {groups.map((g) => (
            <div key={g.label ?? "top"}>
              {g.label && <div className="nav-group-label">{g.label}</div>}
              {g.items.map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  onClick={close}
                  className={`nav-item ${isActive(it.href) ? "nav-item-active" : ""}`}
                >
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.badge ? <span className="nav-badge">{it.badge}</span> : null}
                </Link>
              ))}
            </div>
          ))}
          {footerItems.length > 0 && (
            <div className="mt-2 border-t border-neutral-100 pt-2">
              {footerItems.map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  onClick={close}
                  className={`nav-item ${isActive(it.href) ? "nav-item-active" : ""}`}
                >
                  {it.label}
                </Link>
              ))}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-neutral-100 px-3 pt-3 text-xs text-warm-grey">
            {children}
          </div>
        </div>
      )}
    </>
  );
}
