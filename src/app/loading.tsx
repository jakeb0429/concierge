/** Route-level fallback for every page without its own skeleton — navigation
 *  always paints something immediately. */
export default function AppLoading() {
  return (
    <div>
      <div className="mb-4 h-4 w-40 animate-pulse rounded-lg bg-neutral-200/70" />
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl border border-neutral-200 bg-white" />
        ))}
      </div>
      <p className="mt-4 text-center text-xs text-warm-grey">Loading…</p>
    </div>
  );
}
