"use client";

import { useEffect, useRef, useState } from "react";

type Item = { sku?: string; title?: string; price?: string; quantity: number; reason?: string };
type OrderResult = { invoiceUrl: string; name: string; totalPrice: string };
type Product = { sku: string; label: string; search: string; inStock: boolean; onReplen: boolean };

// Categories where the order panel opens (and pre-fills) automatically.
const AUTO = new Set(["warranty", "returns_exchange", "replacement_parts"]);

/**
 * Build a Shopify checkout link for the customer from a ticket reply. AI
 * pre-fills the line items (for warranty / arm / exchange), the rep corrects
 * unit/quantity, sets a discount, and the generated one-click link drops into
 * the reply. The Shopify draft order is created server-side via Birdseye.
 */
export default function OrderPanel({
  ticketId,
  categoryKey,
  onLink,
}: {
  ticketId: string;
  categoryKey: string | null | undefined;
  // Reconcile the checkout link in the reply body: remove `oldText` (if any) and
  // insert `newText` (if any). Retracts a stale link when items change, and
  // replaces (never stacks) the link on regenerate.
  onLink: (oldText: string | null, newText: string | null) => void;
}) {
  const auto = !!categoryKey && AUTO.has(categoryKey);
  const [open, setOpen] = useState(auto);
  const [items, setItems] = useState<Item[]>([]);
  const [note, setNote] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [suggested, setSuggested] = useState(false);
  const [discountType, setDiscountType] = useState<"" | "PERCENTAGE" | "FIXED_AMOUNT">("");
  const [discountValue, setDiscountValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OrderResult | null>(null);
  const didSuggest = useRef(false);
  const lastInsertedRef = useRef<string | null>(null);
  // Searchable product picker: the orderable catalog (in stock or on replen),
  // loaded once and filtered client-side as the rep types.
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [pickerQuery, setPickerQuery] = useState("");
  const catalogLoaded = useRef(false);

  // Any change to items/discount makes an already-inserted link stale: retract
  // it from the reply and clear the result so the rep must regenerate.
  function invalidateLink() {
    setResult(null);
    if (lastInsertedRef.current) {
      onLink(lastInsertedRef.current, null);
      lastInsertedRef.current = null;
    }
  }

  async function loadCatalog() {
    if (catalogLoaded.current) return;
    catalogLoaded.current = true;
    try {
      const res = await fetch(`/api/products`);
      const d = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(d.products)) setCatalog(d.products);
    } catch {
      /* picker just stays empty — custom lines still work */
    }
  }

  const pquery = pickerQuery.trim().toLowerCase();
  const matches = pquery
    ? catalog.filter((p) => pquery.split(/\s+/).every((w) => p.search.includes(w))).slice(0, 25)
    : [];

  function pickProduct(p: Product) {
    setItems((prev) => {
      // Already on the order? bump its quantity instead of duplicating the line.
      const idx = prev.findIndex((it) => it.sku?.toLowerCase() === p.sku.toLowerCase());
      if (idx >= 0) return prev.map((it, i) => (i === idx ? { ...it, quantity: Math.min(999, it.quantity + 1) } : it));
      return [...prev, { sku: p.sku, title: p.label, quantity: 1 }];
    });
    setPickerQuery("");
    invalidateLink();
  }

  async function suggest() {
    if (suggesting) return;
    setSuggesting(true);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/order/suggest`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setItems(Array.isArray(d.items) ? d.items : []);
        setNote(typeof d.note === "string" ? d.note : "");
      } else {
        setError(d.error ?? "Couldn't suggest items.");
      }
    } catch {
      setError("Couldn't reach the suggestion service.");
    } finally {
      setSuggested(true);
      setSuggesting(false);
    }
  }

  // Auto pre-fill once, for warranty/arm/exchange tickets.
  useEffect(() => {
    if (auto && open && !didSuggest.current) {
      didSuggest.current = true;
      suggest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, open]);

  const PRICE_RE = /^\d+(\.\d{1,2})?$/;
  const validItems = items.filter(
    (i) =>
      i.quantity >= 1 &&
      (i.sku?.trim() ||
        (i.title?.trim() && i.price != null && PRICE_RE.test(i.price ?? "") && parseFloat(i.price ?? "0") > 0)),
  );
  const discountReady =
    discountType === "" ||
    (discountValue.trim() !== "" &&
      Number(discountValue) >= 0 &&
      (discountType !== "PERCENTAGE" || Number(discountValue) <= 100));

  async function generate() {
    if (busy || validItems.length === 0 || !discountReady) return;
    setBusy(true); // MED8: guard against double-submit -> duplicate draft orders
    setError(null);
    try {
      const body: Record<string, unknown> = {
        items: validItems.map((i) => (i.sku ? { sku: i.sku, quantity: i.quantity } : { title: i.title, price: i.price, quantity: i.quantity })),
      };
      if (discountType !== "") {
        body.discount = { value: Number(discountValue), valueType: discountType };
      }
      const res = await fetch(`/api/tickets/${ticketId}/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.invoiceUrl) {
        setError(d.error ?? "Couldn't build the checkout link.");
        return;
      }
      const linkText = `You can complete your order securely here:\n${d.invoiceUrl}`;
      onLink(lastInsertedRef.current, linkText); // replace any prior link — never stack two
      lastInsertedRef.current = linkText;
      setResult({ invoiceUrl: d.invoiceUrl, name: d.name, totalPrice: d.totalPrice });
    } catch {
      setError("Couldn't reach the order service.");
    } finally {
      setBusy(false);
    }
  }

  function setQty(idx: number, q: number) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, quantity: Math.max(1, Math.min(999, q)) } : it)));
    invalidateLink(); // items changed -> retract the now-stale link from the reply
  }
  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
    invalidateLink();
  }
  function addCustom() {
    setItems((prev) => [...prev, { title: "", price: "", quantity: 1 }]);
    invalidateLink();
  }
  function editField(idx: number, field: "title" | "price", value: string) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)));
    invalidateLink();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50"
      >
        + Build a Shopify order
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-l-4 border-neutral-200 border-l-emerald-400 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-medium text-emerald-800">Order → checkout link</div>
        <button onClick={() => setOpen(false)} className="text-xs text-neutral-400 hover:text-neutral-600">
          hide
        </button>
      </div>

      {suggesting && <div className="py-3 text-center text-xs text-neutral-400">Suggesting items…</div>}
      {!suggesting && note && <p className="mb-2 text-xs italic text-neutral-500">{note}</p>}

      <div className="space-y-2">
        {items.map((it, idx) => (
          <div key={idx} className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-2 py-1.5">
            <div className="min-w-0 flex-1">
              {it.sku ? (
                <div className="truncate text-xs text-neutral-700">
                  <span className="font-medium">{it.title ?? it.sku}</span>
                  <span className="text-neutral-400"> · {it.sku}</span>
                </div>
              ) : (
                <div className="flex gap-1">
                  <input
                    value={it.title ?? ""}
                    onChange={(e) => editField(idx, "title", e.target.value)}
                    placeholder="Custom line (e.g. Replacement arm)"
                    className="min-w-0 flex-1 rounded border border-neutral-200 bg-white px-2 py-1 text-xs"
                  />
                  <input
                    value={it.price ?? ""}
                    onChange={(e) => editField(idx, "price", e.target.value)}
                    placeholder="6.00"
                    className="w-16 rounded border border-neutral-200 bg-white px-2 py-1 text-xs"
                  />
                </div>
              )}
              {it.reason && <div className="mt-0.5 truncate text-[10px] text-neutral-400">{it.reason}</div>}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setQty(idx, it.quantity - 1)} className="h-6 w-6 rounded border border-neutral-300 text-xs hover:bg-neutral-100">−</button>
              <span className="w-6 text-center text-xs tabular-nums">{it.quantity}</span>
              <button onClick={() => setQty(idx, it.quantity + 1)} className="h-6 w-6 rounded border border-neutral-300 text-xs hover:bg-neutral-100">+</button>
            </div>
            <button onClick={() => removeItem(idx)} className="text-xs text-neutral-400 hover:text-red-500">✕</button>
          </div>
        ))}
        {suggested && items.length === 0 && (
          <p className="text-xs text-neutral-400">No items yet — search for a product below, or add a custom line.</p>
        )}
      </div>

      {/* searchable product picker — filters the orderable catalog by name or SKU */}
      <div className="relative mt-2">
        <input
          value={pickerQuery}
          onFocus={() => loadCatalog()}
          onChange={(e) => { loadCatalog(); setPickerQuery(e.target.value); }}
          placeholder="Add a product — search by name or SKU (e.g. Bimini)…"
          className="w-full rounded border border-neutral-200 bg-white px-2 py-1 text-xs"
        />
        {pquery && (
          <div className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-neutral-200 bg-white shadow-lg">
            {matches.length === 0 ? (
              <div className="px-3 py-2 text-xs text-neutral-400">No available product matches “{pickerQuery}”.</div>
            ) : (
              matches.map((p) => (
                <button
                  key={p.sku}
                  onClick={() => pickProduct(p)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-neutral-50"
                >
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{p.label}</span>
                    <span className="text-neutral-400"> · {p.sku}</span>
                  </span>
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${p.inStock ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                    {p.inStock ? "in stock" : "on replen"}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div className="mt-2 flex gap-2 text-xs">
        <button onClick={addCustom} className="rounded border border-neutral-300 px-2 py-1 text-neutral-600 hover:bg-neutral-50">+ Custom line</button>
        {!suggested && !suggesting && (
          <button onClick={suggest} className="rounded border border-neutral-300 px-2 py-1 text-neutral-600 hover:bg-neutral-50">Suggest with AI</button>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs">
        <span className="text-neutral-500">Discount:</span>
        <select
          value={discountType}
          onChange={(e) => { setDiscountType(e.target.value as "" | "PERCENTAGE" | "FIXED_AMOUNT"); invalidateLink(); }}
          className="rounded border border-neutral-200 bg-white px-1.5 py-1"
        >
          <option value="">None</option>
          <option value="PERCENTAGE">% off</option>
          <option value="FIXED_AMOUNT">$ off</option>
        </select>
        {discountType !== "" && (
          <input
            value={discountValue}
            onChange={(e) => { setDiscountValue(e.target.value); invalidateLink(); }}
            placeholder={discountType === "PERCENTAGE" ? "50" : "6.00"}
            className="w-20 rounded border border-neutral-200 bg-white px-2 py-1"
          />
        )}
      </div>

      {error && <div className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      {result ? (
        <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          <div className="font-medium">Order {result.name} · total ${result.totalPrice}</div>
          {parseFloat(result.totalPrice) <= 0 ? (
            <div className="mt-0.5 font-medium text-amber-700">⚠ This order totals $0 — confirm that&apos;s intended (free/warranty) before sending.</div>
          ) : (
            <div className="mt-0.5 text-emerald-700">Checkout link inserted into the reply below — review the total before sending.</div>
          )}
          <button onClick={invalidateLink} className="mt-1 text-emerald-700 underline">Rebuild</button>
        </div>
      ) : (
        <button
          onClick={generate}
          disabled={busy || validItems.length === 0 || !discountReady}
          className="mt-3 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
        >
          {busy ? "Building link…" : "Generate checkout link"}
        </button>
      )}
    </div>
  );
}
