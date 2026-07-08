"use client";

import { useState } from "react";

/** Shown only when the signed-in email is provisioned on more than one brand. */
export default function BrandSwitcher({
  current,
  tenants,
}: {
  current: string;
  tenants: { slug: string; name: string }[];
}) {
  const [busy, setBusy] = useState(false);

  async function switchTo(slug: string) {
    if (slug === current || busy) return;
    setBusy(true);
    const res = await fetch("/api/tenant/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantSlug: slug }),
    });
    if (res.ok) window.location.href = "/"; // tenant changed — full reload, back to the inbox
    else setBusy(false);
  }

  return (
    <select
      value={current}
      disabled={busy}
      onChange={(e) => switchTo(e.target.value)}
      className="rounded-lg border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-600"
    >
      {tenants.map((t) => (
        <option key={t.slug} value={t.slug}>
          {t.name}
        </option>
      ))}
    </select>
  );
}
