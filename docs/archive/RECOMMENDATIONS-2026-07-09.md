# Concierge — recommendations report (2026-07-09)

Produced by a 7-agent research pass (reporting, UI/design, performance, Rheos
experience, Stingray/Outlook readiness, boat-builder brain ingestion, plus an
adversarial critic that checked findings against the repo and today's commits).
Everything here is grounded in code/data reads, several perf items in live
EXPLAIN ANALYZE traces. Priorities: **now** (high value, unblocked), **next**
(small dependency), **later** (bigger lift or needs a decision).

---

## 1. Do-first list (cross-cutting, highest leverage)

1. **Prisma `relationLoadStrategy: "join"`** — measured: the ticket page's
   `findFirst` with nested includes issues **5-7 sequential SQL round trips**
   (~224-280ms each from Frankfurt→Oregon ≈ 1.1-1.4s for ONE query call). The
   inbox render costs ~16-17 round trips against a 6-connection pool. Enabling
   Prisma's join strategy (previewFeature `relationJoins`) collapses nested
   includes into single queries. Biggest single lever in the app. [now/M]
2. **Free fix:** `computeResponseTimes` on /analytics runs serially AFTER the
   main `Promise.all` with zero data dependency — move it into the batch.
   [now/S]
3. **pg_trgm GIN index migration** for related-customers: one lookup currently
   seq-scans all 80,343 CustomerOrder rows (211ms DB time measured). Ship
   `CREATE EXTENSION pg_trgm` + GIN indexes on shipName/buyerName/email as a
   committed migration. Also a hard prerequisite for any household-LTV batch
   report. [now/S]
4. **Cron monitoring / dead-man switch** (critic): the entire intake pipeline
   is a crontab entry. If Google creds expire or the box reboots wrong,
   tickets silently stop arriving. A "last successful run per job" heartbeat
   row + admin panel tile + alert email is cheaper than any new report and
   protects everything. Birdseye cron incidents have happened before (7/04).
5. **Tenant-isolation test suite before Stingray goes live** (critic): every
   tenant-scoped query must filter tenantId — one missed where-clause leaks
   Rheos PII to Stingray reps or vice versa. Add a cross-tenant test pass and
   harden the soft /reviews gate (HANDOFF known limitation: any signed-in
   agent can approve knowledge).
6. **Stale-comment regression risk:** prisma/schema.prisma:10-13 still says
   DATABASE_URL = transaction pooler — backwards vs the deployed session-pooler
   fix. Two schema-touching commits shipped today without catching it; the
   next one might "fix" the env to match the comment and reintroduce the
   7-9s ticket pages. One-line doc fix. [now/S]

## 2. Reporting additions

Wholesale/B2B: the D2C-vs-B2B revenue/ticket split shipped today (B2B = 53%
of trailing-12mo revenue). Remaining wholesale gaps are dealer-LEVEL:

- **Dealer intelligence dashboard** [now/M] — leaderboard by trailing-12mo
  volume/recency from StockistSale; "gone cold" list (no order in 6+ months =
  churn risk for sales to chase); state coverage vs support-inquiry origin;
  product sell-through by state. Doubles as the template for Stingray's
  dealer feed.
- **Brain health report** [now/M] — Draft.coverage full/partial/none rate by
  category over time (where drafts keep landing "none" = content backlog);
  recurring policyFlags; stale KnowledgeItems (timesCited=0 / lastCitedAt >
  90d); LearningSignal funnel with days-to-resolution.
- **Rep coaching scorecard** [now/M] — pair speed (exists) with quality: per-
  rep edit rate (editedBody != null), review-return rate + reviewNote text,
  self-flagged corrections. Send attribution (actorId on reply_sent) only
  accrues from today forward.
- **Revenue-at-risk** [now/M] — "$X of lifetime value sits behind this
  quarter's negative-sentiment / open-return customers" (joins that already
  exist in customer-insight/returns).
- **Product-friction report** [now/M] — inquiry/negative rate per silhouette
  vs how much it sells and how many dealers carry it (AnalyticsInquiry ×
  StockistSale × SalesMonthly). Merchandising/QA signal.
- **Digest deltas + per-rep digest** [now/S each] — call buildDigest twice and
  diff vs prior period; loop tenant users mailing each rep their own myStats.
- **CSV export helper** [now/S] — zero export code exists; one toCsv() + role-
  gated /api/export/* routes covering analytics rows, audit list, response
  times. (Leadership PDF: start with a print stylesheet — see UI — not a
  headless-Chrome pipeline; critic flagged the ops weight on the single box.)
- **Household LTV rollup** [next/M] — needs the pg_trgm index first, then a
  nightly batch materializing household groupings; the live per-profile match
  must not be run in bulk as-is (critic: seq-scan storm through the shared
  15-client pool).
- **Wholesale mined history** [next] — AnalyticsInquiry (2,770 rows) is hello@
  only; the analytics history section now says so. Backfilling wholesale@
  history = a mining run over that mailbox (model cost, needs a go-ahead).

Sequencing caveat (critic): land the §1 perf fixes (or build these as
nightly-precomputed rows) BEFORE adding more live-query report surfaces.

## 3. Design / UI

Quick accessibility wins [both now/S]:
- **Focus states are nearly invisible** app-wide (`outline-none` +
  neutral-200→300 border shift). Add a visible gold focus ring — one CSS rule.
- **text-neutral-400 (#a3a3a3, ~2.5:1) is used for real content** (empty
  states, counts, timestamps). Move meaningful copy to text-warm-grey
  (#7a7470, ~4.6:1 — already the house fine-print color).
- **ARIA is absent** outside one chart; icon-only buttons (✎, ×, →) need
  aria-labels. [now/S]

Experience:
- **Keyboard triage** [next/M] — j/k row nav in the inbox, cmd+enter to send,
  a shortcut for the already-prewarmed "Next ticket".
- **Mobile inbox** [next/L] — the table forces horizontal scroll at 375px;
  needs a card-list fallback under md:. Biggest rep-on-phone gap.
- **Admin nav cluster** [next/S] — 9 flat items already overflow the header;
  group Digest/Team/Sources/Audit under "Admin" (validates the parked idea).
- **Chip/badge component consolidation** [next/M] — badge styling copy-pasted
  20+ times; extract one Chip component next to the existing helpers.
- **Digest print stylesheet** [next/S] — @media print pass makes the digest a
  shareable leadership one-pager for ~zero cost.
- **Empty-state voice** [later/S] — inbox's "Nothing here." vs the app's
  otherwise warm voice; small copy pass.
- **Dark mode** [later/L] — systemic absence; genuine but large.

## 4. Performance (beyond §1)

- **Inbox fan-out** [now/M] — consolidate the two independently-queried
  ticket lists; with relationJoins the render drops from ~16-17 to ~4-5
  round trips.
- **Analytics caching** [next/M] — the 365d AnalyticsInquiry fetch (782KB,
  ~550-670ms, nightly-changing data) re-runs per render; unstable_cache or a
  precomputed-rows table.
- **Retrieval cache WITH invalidation** [next/S] — cache the 82 approved
  KnowledgeItems on the draft path, but ONLY with explicit invalidation on
  approve/edit (valid in the single PM2 process). A plain TTL cache would
  make a rep's just-taught item invisible for 10 minutes — exactly the
  trust-killer during dogfood (critic caught this).
- **ShipStation cache eviction** [later/S] — unbounded Map growth over PM2
  uptime.
- **DB region migration (eu-central-1)** [later/L, parked with Jake] —
  quantified: ticket page ≈ 2-2.5s of pure network latency today; Frankfurt
  co-location cuts ~90% of that. Prerequisite (critic): a rehearsed
  backup/restore path BEFORE attempting the move.

## 5. Rheos experience

- **Teach a general returns/exchange policy KnowledgeItem** [now/S] — zero
  'Returns'-category items exist; returns_exchange is the 6th-largest real
  category (169/365d). Highest-leverage Brain gap. Needs Jake/rep content:
  restocking fee, condition requirements, who pays return shipping.
- **Hand-author the 3 missing playbooks** [now/S] — replacement_parts (2nd-
  largest category, 313/365d), returns_exchange, sizing_fit; the miner skips
  categories with <4 usable historical exchanges.
- **The LearningSignal flywheel is cold** [now/S] — zero rows in prod; the
  teach controls have apparently never been used on a real ticket. Worth a
  deliberate dogfood week before building more on top.
- **returnStatus manual override** [next/S] — nothing ever advances past
  "requested"; reps need a way to record "approved by hand / refunded outside
  the tool" or the pipeline panel reads forever-stuck.
- **Thread the household match into the workspace as a link** [now/S] — the
  eligibility hint flattens RelatedCandidate.customerId into prose; return it
  structured so the banner links to the household profile.
- **Pass detected product mentions to the draft engine** [next/S] — computed
  every draft, only used for stockists; push a product liveContext line.
- **Structured sizing/fit data** [next/M] — lens size/base curve exist in the
  HubSpot import but are trapped in prose; persist on ProductFamily and use
  for sizing_fit drafts.
- **Proactive shipping-delay detector** [later/M] — sibling of detect-handled:
  flag awaiting_shipment > N days before the customer emails.
- **Review-request timing** [later/M] — needs a vendor/product decision first.
- **Phase B build list** (ShipStation labels): capture ShipStation's internal
  order id; carrier/service choice; a NON-fail-soft label call; schema for
  label URL + tracking; rep confirm UI. **Phase C** (refunds): needs
  write_orders scope added in Shopify Dev Dashboard AND the numeric order id
  captured by the importer (only order_number is stored today).

## 6. Stingray preparation (Outlook/M365 + boat-builder brain)

Channel gap list (in order):
1. **GraphMailAdapter is 100% stubbed** — every method throws. Interface and
   provider routing are correct; the implementation is the work. [now/L]
2. **credentialsFor() has no "graph" branch** — Stingray sends stay stubbed
   even after the adapter is coded; STINGRAY_GRAPH_* placeholders already in
   .env.example. [now/S]
3. **No intake-graph cron** — intake-gmail.ts is Gmail-hardcoded by design;
   Stingray tickets will never appear without prisma/intake-graph.ts + a
   cron line. [now/L]
4. **Attachment route is Gmail-hardcoded** — will fail for every Stingray
   attachment; branch by provider. [now/M]
5. **"Rheos support" is hardcoded** on every outbound bubble in the ticket
   workspace — day-one branding bug for the pilot team. [now/S]
6. **Mailbox address mismatch** — the M365 IT doc provisions
   hello@stingrayboats.com (ApplicationAccessPolicy scoped to ONLY it) but
   the seeded Channel row says support@stingrayboats.com. Resolve with
   Stingray IT before the Azure app is scoped. [now/S — decision]
7. **Sentry** — the repo's own Tier-3 trigger ("when Stingray onboards");
   land before/with the Graph adapter. [now/M]
8. Outlook deep link (View original), graph-path tests (send-gate tests are
   gmail-only; money-path standard applies), e2e auth check for a
   stingrayboats.com user. [next]
9. **Capacity go-live gate** (critic): second intake cron + second rep team +
   doubled drafting land on the same connection_limit=6 / 15-client cap and
   single PM2 process — relationJoins + retrieval cache + connection budget
   math should ship BEFORE Stingray turns on.

Boat-builder brain ingestion (source: Ali's live FastAPI service):
- **KnowledgeBaseEntry is a near-1:1 match for KnowledgeItem** (question,
  answer, category, audience, tags, valid_from/until) — richest source, but
  its admin endpoint needs a superuser JWT → coordination item with Ali
  (or a read-only Supabase grant). [now]
- **Public, unauthenticated today:** GET /catalog, /catalog/{slug},
  /dealers, /dealers/nearby — safe to sync now with bounded fetches.
- **Pipeline shape:** prisma/import-boat-catalog.ts on the import-products.ts
  template (upsert-by-title, never delete cited entries), nightly cron at a
  free slot; embed-knowledge.ts picks up new rows automatically. [now/M]
- **Dealer locator:** sync the boat-builder `dealers` table (real lat/lng)
  into a new Dealer table + Haversine helper mirroring findStockists — a
  cleaner source than Rheos's order-derived StockistSale. [next/M]
- **Do NOT ingest pricing** — engine-dependent computed pricing, seasonal
  rules, and access-gated dealer tiers; at most a dated "starting at MSRP"
  snapshot line with a confirm-with-dealer caveat. Stable compatibility
  rules (e.g. "Suzuki engine requires Suzuki pre-rig") from
  pricing_rules.llm_summary ARE safe and useful. [now — policy]
- **Audience gating gap:** KnowledgeItem has no audience/sensitivity field;
  v1 must ingest only audience in (customer, both). Adding a real audience
  field wired into retrieval is a prerequisite for dealer/internal slices.
  [later/M]
- **Dealers Circle/ERP is separate** — it's the CustomerOrder-equivalent,
  still blocked on Stuart/Warren's export format; the boat-builder seed
  doesn't depend on it.

## 7. Critic's missing angles (nobody owned these)

- Tenant isolation + /reviews gate hardening + Graph webhook HMAC (see §1.5).
- Silent cron failure monitoring (see §1.4).
- **Outbound send safety:** double-click send idempotency, auto-responder
  loop suppression on intake, In-Reply-To/References threading correctness,
  bounce handling — money paths per the standards doc, currently unverified.
- Second-tenant capacity sequencing (see §6.9).
- **Backup/restore rehearsal + PII retention policy** — nightly-mutated
  shared DB, region migration parked; a rehearsed restore outranks every
  perf item. Also: retention windows / right-to-delete for CustomerOrder,
  Message, and the HubSpot-mined corpus.

## Stale docs noted by the researchers

- HANDOFF known-limitation "single-tenant hardcode getCurrentTenant()" is
  outdated — the resolver is session-scoped since the multi-user build.
- prisma/schema.prisma datasource comments are backwards (see §1.6).
