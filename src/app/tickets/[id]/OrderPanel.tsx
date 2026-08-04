"use client";

import { useEffect, useRef, useState } from "react";

type DiscType = "PERCENTAGE" | "FIXED_AMOUNT";
type LineDisc = { valueType: DiscType; value: string };
// msrp = the rep's explicit unit price: a custom line's price, or a catalog
// line's OVERRIDE. Undefined on a catalog line means "use the live catalog price".
type Item = { sku?: string; title?: string; quantity: number; reason?: string; msrp?: string; discount?: LineDisc };
type OrderResult = { invoiceUrl: string; name: string; subtotalPrice: string; totalTax: string; totalPrice: string };
type Product = { sku: string; label: string; search: string; price: number | null; inStock: boolean; onReplen: boolean };

const AUTO = new Set(["warranty", "returns_exchange", "replacement_parts"]);
const money = (n: number) => n.toFixed(2);
const PRICE_RE = /^\d+(\.\d{1,2})?$/;

/**
 * Build a Shopify checkout link for the customer from a ticket reply. AI
 * pre-fills the line items (for warranty / arm / exchange); the rep revises the
 * table (SKU · name · MSRP · qty · discount), where MSRP is the live website
 * price and is editable (an edit overrides that line's price). Discounts apply
 * per line or to the whole order. The Shopify draft order is created via Birdseye.
 */
export default function OrderPanel({
  ticketId,
  categoryKey,
  onLink,
}: {
  ticketId: string;
  categoryKey: string | null | undefined;
  onLink: (oldText: string | null, newText: string | null) => void;
}) {
  const auto = !!categoryKey && AUTO.has(categoryKey);
  const [open, setOpen] = useState(auto);
  const [items, setItems] = useState<Item[]>([]);
  const [note, setNote] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [suggested, setSuggested] = useState(false);
  const [discountMode, setDiscountMode] = useState<"order" | "line">("order");
  const [orderType, setOrderType] = useState<"" | DiscType>("");
  const [orderValue, setOrderValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OrderResult | null>(null);
  const didSuggest = useRef(false);
  const lastInsertedRef = useRef<string | null>(null);
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [pickerQuery, setPickerQuery] = useState("");
  const catalogLoaded = useRef(false);

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
      /* picker stays empty — custom lines still work */
    }
  }

  const catMap = new Map(catalog.map((p) => [p.sku.toLowerCase(), p] as const));
  const catPrice = (it: Item): number | null => (it.sku ? catMap.get(it.sku.toLowerCase())?.price ?? null : null);
  // The MSRP shown/edited: explicit override if set, else the live catalog price.
  const msrpStr = (it: Item): string => (it.msrp != null && it.msrp !== "" ? it.msrp : catPrice(it) != null ? catPrice(it)!.toFixed(2) : "");
  const unitPrice = (it: Item): number | null => {
    const n = parseFloat(msrpStr(it));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const isOverride = (it: Item): boolean => {
    if (!it.sku || it.msrp == null || it.msrp.trim() === "") return false;
    const cp = catPrice(it);
    return cp == null || Math.abs(parseFloat(it.msrp) - cp) >= 0.005;
  };

  const pquery = pickerQuery.trim().toLowerCase();
  const matches = pquery ? catalog.filter((p) => pquery.split(/\s+/).every((w) => p.search.includes(w))).slice(0, 25) : [];

  function pickProduct(p: Product) {
    setItems((prev) => {
      const idx = prev.findIndex((it) => it.sku?.toLowerCase() === p.sku.toLowerCase());
      if (idx >= 0) return prev.map((it, i) => (i === idx ? { ...it, quantity: Math.min(999, it.quantity + 1) } : it));
      return [...prev, { sku: p.sku, title: p.label, quantity: 1 }]; // MSRP derived from the live catalog
    });
    setPickerQuery("");
    invalidateLink();
  }

  async function suggest() {
    if (suggesting) return;
    setSuggesting(true);
    setError(null);
    loadCatalog(); // so suggested catalog lines show their live MSRP
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

  useEffect(() => {
    if (auto && open && !didSuggest.current) {
      didSuggest.current = true;
      suggest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, open]);

  // --- money math (indicative — the authoritative total comes from Shopify) ---
  const parseDisc = (d: LineDisc | undefined): { discount: { valueType: DiscType; value: number } | null; valid: boolean } => {
    if (!d || d.value.trim() === "") return { discount: null, valid: true };
    const v = Number(d.value);
    const valid = Number.isFinite(v) && v >= 0 && (d.valueType !== "PERCENTAGE" || v <= 100);
    return { discount: valid ? { valueType: d.valueType, value: v } : null, valid };
  };
  const applyDisc = (base: number, d: { valueType: DiscType; value: number } | null): number => {
    if (!d) return base;
    return d.valueType === "PERCENTAGE" ? Math.max(0, base * (1 - d.value / 100)) : Math.max(0, base - d.value);
  };
  const lineNet = (it: Item): number | null => {
    const u = unitPrice(it);
    if (u == null) return null;
    const base = u * it.quantity;
    return discountMode === "line" ? applyDisc(base, parseDisc(it.discount).discount) : base;
  };

  let subtotal = 0;
  let anyUnknown = false;
  for (const it of items) {
    const n = lineNet(it);
    if (n == null) anyUnknown = true;
    else subtotal += n;
  }
  const orderDisc =
    discountMode === "order" && orderType !== "" && orderValue.trim() !== "" && Number.isFinite(Number(orderValue))
      ? { valueType: orderType, value: Number(orderValue) }
      : null;
  const estTotal = discountMode === "order" ? applyDisc(subtotal, orderDisc) : subtotal;

  const validItems = items.filter((i) => {
    if (i.quantity < 1) return false;
    const m = i.msrp?.trim();
    if (i.sku) return !m || (PRICE_RE.test(m) && parseFloat(m) > 0); // empty -> uses catalog price
    return !!(i.title?.trim() && m && PRICE_RE.test(m) && parseFloat(m) > 0);
  });
  const orderDiscValid =
    discountMode !== "order" ||
    orderType === "" ||
    (orderValue.trim() !== "" && Number(orderValue) >= 0 && (orderType !== "PERCENTAGE" || Number(orderValue) <= 100));
  const lineDiscValid = discountMode !== "line" || items.every((it) => parseDisc(it.discount).valid);

  async function generate() {
    if (busy || validItems.length === 0 || !orderDiscValid || !lineDiscValid) return;
    setBusy(true); // guard against double-submit -> duplicate draft orders
    setError(null);
    try {
      const body: Record<string, unknown> = {
        items: validItems.map((i) => {
          const disc = discountMode === "line" ? parseDisc(i.discount).discount : null;
          const m = i.msrp?.trim();
          // Unedited catalog line -> send the SKU (Shopify's canonical price).
          // Custom line OR overridden catalog line -> a custom line at the set price.
          const line =
            i.sku && !isOverride(i)
              ? { sku: i.sku, quantity: i.quantity }
              : { title: i.title || i.sku, price: m && m !== "" ? m : catPrice(i)?.toFixed(2) ?? "", quantity: i.quantity };
          return disc ? { ...line, discount: disc } : line;
        }),
      };
      if (discountMode === "order" && orderType !== "" && orderValue.trim() !== "") {
        body.discount = { value: Number(orderValue), valueType: orderType };
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
      setResult({ invoiceUrl: d.invoiceUrl, name: d.name, subtotalPrice: d.subtotalPrice, totalTax: d.totalTax, totalPrice: d.totalPrice });
    } catch {
      setError("Couldn't reach the order service.");
    } finally {
      setBusy(false);
    }
  }

  function patch(idx: number, next: Partial<Item>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...next } : it)));
    invalidateLink();
  }
  function setQty(idx: number, q: number) {
    patch(idx, { quantity: Math.max(1, Math.min(999, q)) });
  }
  function setLineDisc(idx: number, next: Partial<LineDisc>) {
    setItems((prev) =>
      prev.map((it, i) =>
        i === idx ? { ...it, discount: { valueType: next.valueType ?? it.discount?.valueType ?? "PERCENTAGE", value: next.value ?? it.discount?.value ?? "" } } : it,
      ),
    );
    invalidateLink();
  }
  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
    invalidateLink();
  }
  function addCustom() {
    setItems((prev) => [...prev, { title: "", quantity: 1, msrp: "" }]);
    invalidateLink();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-3 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50">
        + Build a Shopify order
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-l-4 border-gold/30 border-l-gold/60 bg-cream/40 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-medium text-emerald-800">Order → checkout link</div>
        <button onClick={() => setOpen(false)} className="text-xs text-neutral-400 hover:text-neutral-600">hide</button>
      </div>

      {suggesting && <div className="py-3 text-center text-xs text-neutral-400">Suggesting items…</div>}
      {!suggesting && note && <p className="mb-2 text-xs italic text-neutral-500">{note}</p>}

      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-neutral-100 text-left text-[10px] uppercase tracking-wide text-neutral-400">
                <th className="py-1 pr-2 font-medium">Product</th>
                <th className="px-2 py-1 font-medium">SKU</th>
                <th className="px-2 py-1 text-right font-medium">MSRP</th>
                <th className="px-2 py-1 text-center font-medium">Qty</th>
                {discountMode === "line" && <th className="px-2 py-1 font-medium">Discount</th>}
                <th className="px-2 py-1 text-right font-medium">Line total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => {
                const net = lineNet(it);
                const dv = parseDisc(it.discount);
                return (
                  <tr key={idx} className="border-b border-neutral-50 align-middle">
                    <td className="py-1.5 pr-2">
                      {it.sku ? (
                        <div className="max-w-[180px] truncate font-medium text-neutral-700" title={it.title ?? it.sku}>{it.title ?? it.sku}</div>
                      ) : (
                        <input value={it.title ?? ""} onChange={(e) => patch(idx, { title: e.target.value })} placeholder="Custom line (e.g. Replacement arm)" className="w-40 rounded border border-neutral-200 bg-white px-2 py-1" />
                      )}
                      {it.reason && <div className="mt-0.5 max-w-[200px] truncate text-[10px] text-neutral-400">{it.reason}</div>}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-[11px] text-neutral-500">{it.sku ?? "custom"}</td>
                    <td className="px-2 py-1.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <span className="text-neutral-400">$</span>
                        <input
                          value={msrpStr(it)}
                          onChange={(e) => patch(idx, { msrp: e.target.value })}
                          placeholder="0.00"
                          className="w-16 rounded border border-neutral-200 bg-white px-1.5 py-1 text-right tabular-nums"
                        />
                      </div>
                      {isOverride(it) && <div className="text-right text-[9px] text-amber-600">custom price</div>}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => setQty(idx, it.quantity - 1)} className="h-5 w-5 rounded border border-neutral-300 hover:bg-neutral-100">−</button>
                        <span className="w-5 text-center tabular-nums">{it.quantity}</span>
                        <button onClick={() => setQty(idx, it.quantity + 1)} className="h-5 w-5 rounded border border-neutral-300 hover:bg-neutral-100">+</button>
                      </div>
                    </td>
                    {discountMode === "line" && (
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1">
                          <select value={it.discount?.valueType ?? "PERCENTAGE"} onChange={(e) => setLineDisc(idx, { valueType: e.target.value as DiscType })} className="rounded border border-neutral-200 bg-white px-1 py-1">
                            <option value="PERCENTAGE">%</option>
                            <option value="FIXED_AMOUNT">$</option>
                          </select>
                          <input value={it.discount?.value ?? ""} onChange={(e) => setLineDisc(idx, { value: e.target.value })} placeholder="0" className={`w-12 rounded border bg-white px-1.5 py-1 ${dv.valid ? "border-neutral-200" : "border-red-300"}`} />
                        </div>
                      </td>
                    )}
                    <td className="px-2 py-1.5 text-right font-medium tabular-nums text-neutral-700">{net != null ? `$${money(net)}` : "—"}</td>
                    <td className="pl-1 text-right"><button onClick={() => removeItem(idx)} className="text-neutral-400 hover:text-red-500">✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {suggested && items.length === 0 && <p className="text-xs text-neutral-400">No items yet — search for a product below, or add a custom line.</p>}

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
                <button key={p.sku} onClick={() => pickProduct(p)} className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-neutral-50">
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{p.label}</span>
                    <span className="text-neutral-400"> · {p.sku}</span>
                    {p.price != null && <span className="text-neutral-400"> · ${money(p.price)}</span>}
                  </span>
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${p.inStock ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{p.inStock ? "in stock" : "on replen"}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div className="mt-2 flex gap-2 text-xs">
        <button onClick={addCustom} className="rounded border border-neutral-300 px-2 py-1 text-neutral-600 hover:bg-neutral-50">+ Custom line</button>
        {!suggested && !suggesting && <button onClick={suggest} className="rounded border border-neutral-300 px-2 py-1 text-neutral-600 hover:bg-neutral-50">Suggest with AI</button>}
      </div>

      {/* discount: whole-order or per-line */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-neutral-500">Discount:</span>
        <div className="flex overflow-hidden rounded-lg border border-neutral-200">
          {(["order", "line"] as const).map((m) => (
            <button key={m} onClick={() => { setDiscountMode(m); invalidateLink(); }} className={`px-2 py-1 ${discountMode === m ? "bg-emerald-600 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"}`}>
              {m === "order" ? "Whole order" : "Per line"}
            </button>
          ))}
        </div>
        {discountMode === "order" ? (
          <>
            <select value={orderType} onChange={(e) => { setOrderType(e.target.value as "" | DiscType); invalidateLink(); }} className="rounded border border-neutral-200 bg-white px-1.5 py-1">
              <option value="">None</option>
              <option value="PERCENTAGE">% off</option>
              <option value="FIXED_AMOUNT">$ off</option>
            </select>
            {orderType !== "" && (
              <input value={orderValue} onChange={(e) => { setOrderValue(e.target.value); invalidateLink(); }} placeholder={orderType === "PERCENTAGE" ? "50" : "6.00"} className={`w-20 rounded border bg-white px-2 py-1 ${orderDiscValid ? "border-neutral-200" : "border-red-300"}`} />
            )}
          </>
        ) : (
          <span className="text-neutral-400">set a discount on each line above</span>
        )}
        <span className="ml-auto text-neutral-600">
          Est. ${money(estTotal)} before tax
          {anyUnknown && <span className="text-neutral-400"> (+ unpriced lines)</span>}
          <span className="text-neutral-400"> · tax added at checkout</span>
        </span>
      </div>

      {error && <div className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      {result ? (
        <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          <div className="font-medium">Order {result.name} · ${result.subtotalPrice} + ${result.totalTax} tax = <span className="underline">${result.totalPrice}</span></div>
          {parseFloat(result.totalPrice) <= 0 ? (
            <div className="mt-0.5 font-medium text-amber-700">⚠ This order totals $0 — confirm that&apos;s intended (free/warranty) before sending.</div>
          ) : (
            <div className="mt-0.5 text-emerald-700">Checkout link inserted into the reply below — review the total before sending.</div>
          )}
          <button onClick={invalidateLink} className="mt-1 text-emerald-700 underline">Rebuild</button>
        </div>
      ) : (
        <button onClick={generate} disabled={busy || validItems.length === 0 || !orderDiscValid || !lineDiscValid} className="mt-3 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-40">
          {busy ? "Building link…" : "Generate checkout link"}
        </button>
      )}
    </div>
  );
}
