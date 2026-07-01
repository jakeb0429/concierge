import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Concierge",
  description: "Knowledge-grounded, AI-drafted, human-confirmed customer service.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
            </nav>
            <span className="ml-auto text-xs text-neutral-400">Rheos · hello@rheosgear.com</span>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
