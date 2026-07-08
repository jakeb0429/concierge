"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; badge?: number };

/** Top nav with the current section marked in Scribe gold. */
export default function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <nav className="flex gap-4 text-sm">
      {items.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          className={`flex items-center gap-1 ${
            isActive(it.href) ? "font-semibold text-gold" : "text-neutral-500 hover:text-neutral-900"
          }`}
        >
          {it.label}
          {it.badge ? (
            <span className="rounded-full bg-amber-100 px-1.5 text-[11px] font-medium text-amber-800">
              {it.badge}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
