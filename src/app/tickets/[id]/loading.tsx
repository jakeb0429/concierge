/** Instant skeleton while the ticket workspace server-renders — the click
 *  must visibly do something the moment it happens. */
export default function TicketLoading() {
  const bar = (w: string, h = "h-4") => <div className={`${h} ${w} animate-pulse rounded-lg bg-neutral-200/70`} />;
  return (
    <div>
      <div className="mb-3">{bar("w-16", "h-3")}</div>
      {/* header card */}
      <div className="mb-3 flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3">
        <div className="h-9 w-9 animate-pulse rounded-full bg-neutral-200/70" />
        <div className="space-y-1.5">
          {bar("w-40")}
          {bar("w-56", "h-3")}
        </div>
        <div className="ml-auto flex gap-2">
          {bar("w-20", "h-6")}
          {bar("w-24", "h-6")}
        </div>
      </div>
      {/* stats strip */}
      <div className="mb-3 flex gap-5 rounded-xl border border-neutral-200 bg-white px-4 py-3">
        {bar("w-20", "h-3")}
        {bar("w-24", "h-3")}
        {bar("w-28", "h-3")}
        {bar("w-24", "h-3")}
      </div>
      {/* thread + draft */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-neutral-200 bg-white p-4">
          {bar("w-3/4")}
          {bar("w-full", "h-3")}
          {bar("w-5/6", "h-3")}
          {bar("w-2/3", "h-3")}
        </div>
        <div className="space-y-3 rounded-xl border border-neutral-200 bg-white p-4">
          {bar("w-32")}
          {bar("w-full", "h-24")}
          {bar("w-40", "h-8")}
        </div>
      </div>
      <p className="mt-4 text-center text-xs text-warm-grey">Opening the ticket…</p>
    </div>
  );
}
