# Concierge — Handoff & Transition Document

> Written 2026-07-02 after the initial build sprint (scaffold → production in ~36 hours).
> Live at **https://concierge.scribechs.com** · Repo **github.com/jakeb0429/concierge** (private)
> Audience: Jake, future contributors, and future Claude sessions.

---

## 1. What Concierge is

AI-native customer-service platform for Rheos (first tenant), designed multi-tenant with
Stingray/Microsoft 365 as the planned second tenant. The signature loop: **email arrives →
triaged → AI drafts a reply grounded ONLY in the Brand Brain → a human reviews/steers/confirms →
send**. The tool never contacts a customer on its own, and never invents facts: uncovered
questions produce an honest "not covered" instead of a guess.

Renamed from the design doc's "First Draft" (name collision with the Kids2 tool).
Design source: `iCloud/Claude/Stingray/FirstDraft-App-Design-Plan.md`.

## 2. Architecture in one screen

```
Gmail (hello@ + wholesale@)          HubSpot (history)   Shopify (orders)   Amazon (public.AmazonOrder)
        │ intake cron */10min                │ nightly            │ nightly           │
        ▼                                    ▼                    ▼                   ▼
┌─ TRIAGE (rules + Haiku) ─┐        AnalyticsInquiry      CustomerOrder + SalesMonthly
│ noise → archived+tagged  │        (classified 365d)     (full history, refunds)
│ real → ticket (+product  │                └──────┬──────────┘
│  mention tags)           │                       ▼
└──────────┬───────────────┘              /analytics + /customers/[id]
           ▼
    TICKET WORKSPACE ──────────────────────────────────────────────────────────┐
    thread (clean, images) · customer stats strip · AI draft (coverage,        │
    citations, policy flags) · steer chips/notes · submit-for-review ·         │
    confirm-and-send → Gmail (To/threading correct, live)                      │
           │                                                                   │
           ▼                                                                   ▼
    LEDGER (AuditEvent, Draft rows — complete, never prompted)          /reviews (manager queue)
           │ nightly detector
           ▼
    LearningSignal proposals → Brain manager approve → BRAND BRAIN updated in place
    (Brain = ~90 curated entries: brand docs, mined FAQ, reply playbooks,
     69 product families, inventory snapshot — retrieved top-k per draft,
     lexical fast path + Voyage semantic path)
```

**The two-store learning principle (do not break this):** the Ledger logs everything and is
never in a prompt; the Brain is small, curated, versioned, and is the only grounding source.
Learning = human-approved updates to existing entries, not accumulation.

**The Microsoft seam:** core code only touches `ChannelAdapter` (`src/lib/channels/types.ts`).
`GmailAdapter` is live; `GraphMailAdapter` is compiled-and-stubbed. Onboarding Stingray =
Azure app registration + fill in the Graph method bodies + a Channel row. Zero core changes.

## 3. Where everything runs

| Thing | Where |
|---|---|
| App | birdseye VPS `72.61.177.29`, `/opt/concierge`, PM2 process `concierge`, port **3014** |
| Web | nginx `sites-available/concierge.scribechs.com`, Let's Encrypt (auto-renew) |
| DB | rheos-inventory Supabase project (`xivgoqvmfmlfsedisnxf`, us-west-2), isolated **`concierge` schema**, pgvector in `extensions` schema. Connect via POOLER host (`aws-0-us-west-2.pooler.supabase.com:5432`) — direct host is dead |
| Deploy | `rsync` source then `ssh root@72.61.177.29 'bash /opt/concierge/scripts/deploy-birdseye.sh'` (idempotent: build, PM2, nginx, crons, smoke check) |

### Local dev layout (since 2026-07-02)
All repos live in iCloud at `Claude/GitHub/`, with `~/Documents/GitHub` a symlink to it (so
every old path still works). Per repo, `node_modules` and `.next` are symlinks to same-dir
`*.nosync` folders — iCloud never syncs those (they'd choke sync), and keeping the real dirs
inside the repo keeps Node/Turbopack realpath resolution happy (external dirs break Prisma's
externals aliasing — tried, reverted). `turbopack.root` is pinned in next.config when running
under iCloud. **Second-machine setup:** create the same `~/Documents/GitHub` symlink, then per
repo `npm install` (the `.nosync` dir is machine-local by design) and copy `.env` securely.

### Cron jobs (root crontab on birdseye, all idempotent)
| When | Job | Log |
|---|---|---|
| every 10 min | `intake-gmail.ts 25` — both mailboxes, full threads, triage, product tags | `/root/concierge-intake.log` |
| 02:30 | `analytics-backfill.ts` — classify new HubSpot threads | `/root/concierge-analytics.log` |
| 03:00 | `import-shopify-orders.ts <prev-month-start>` — incremental orders + refunds | `/root/concierge-orders.log` |
| 03:15 | `dsp-update.cjs` — recompute time-since-purchase | `/root/concierge-analytics.log` |
| 03:30 | `detect-learning.ts` — mine Ledger → LearningSignal proposals | `/root/concierge-learning.log` |
| 04:30 | `import-products.ts` — refresh product catalog/inventory/ProductFamily | `/root/concierge-products.log` |

Not yet scheduled (run manually when wanted): `enrich-inquiries.ts` (product mentions on new
analytics rows), `mine-reply-playbooks.ts` (refresh playbooks), `embed-knowledge.ts` (backfill
embeddings for entries created outside the app).

## 4. Credentials map (all in `/opt/concierge/.env`, gitignored; local copy in repo `.env`)

| Credential | What it does | Notes |
|---|---|---|
| `DATABASE_URL` / `DIRECT_URL` | Supabase pooler | shared project with rheos-inventory |
| `ANTHROPIC_API_KEY` | drafting (Opus), triage/classify (Haiku) | model ids centralized: `src/lib/anthropic.ts`, triage in `src/lib/triage.ts` |
| `RHEOS_GMAIL_CLIENT_EMAIL/PRIVATE_KEY` | service account `concierge-gmail@rheos-floating-s…` w/ domain-wide delegation, scope `gmail.modify` | impersonates hello@ AND wholesale@ |
| `HUBSPOT_TOKEN` | history mining, product catalog | copied from rheos-inventory |
| `SHOPIFY_SHOP/CLIENT_ID/CLIENT_SECRET/API_VERSION` | **Dev Dashboard client credentials** — tokens minted per call, 24 h expiry, `read_all_orders` granted | THIS is why old `shpat_` tokens kept "dying"; there is nothing static to rotate anymore |
| `VOYAGE_API_KEY` | embeddings (voyage-3-large, 1024-dim) | account has NO billing card → 3 req/min throttle |
| `MAILGUN_API_KEY/DOMAIN`, `EMAIL_FROM` | magic-link sign-in email | domain justforfun.scribechs.com |
| `AUTH_SECRET`, `AUTH_URL`, `AUTH_ALLOWLIST` | auth (allowlist gates magic-link; now incl. dev@scribechs.com) | **`AUTH_URL` must stay set** — Auth.js under Next 16 ignores proxy Host headers; losing it regresses sign-in redirects to localhost |
| `CONCIERGE_LIVE_SEND` | `"true"` = replies actually transmit | flip to anything else for log-only soft mode |

## 5. Runbooks

**Deploy a change**
```bash
cd ~/Documents/GitHub/concierge
git add -A && git commit && git push
rsync -az --delete --exclude node_modules --exclude '*.nosync' --exclude .next --exclude .git --exclude .env ./ root@72.61.177.29:/opt/concierge/
ssh root@72.61.177.29 'bash /opt/concierge/scripts/deploy-birdseye.sh'
```

**Auth broken / redirects wrong** → `curl -s https://concierge.scribechs.com/api/auth/providers`
— the `callbackUrl` in the response must be the live domain. If it says localhost, check
`AUTH_URL` in the server env, `pm2 restart concierge --update-env`.
Full login proof: `node scripts/e2e-login-test.cjs` (drives a real production login via hello@).

**Password logins** (added 2026-07-02) → second auth path alongside magic-link: PBKDF2 via Web
Crypto (Edge-safe), constant-time compare. Provision/update: `tsx prisma/set-password.ts
<email> [role] [password]` (password generated + printed once if omitted; having a hash IS the
grant, no signup path). dev@scribechs.com = super_admin with a saved password. NOTE: roles are
still soft — super_admin is stored on the session but nothing role-gates yet (limitation #6).

**Gmail intake stopped** → `tail /root/concierge-intake.log`. Test auth:
`node scripts/gmail-test.cjs` (impersonation + mailbox read). Common cause: someone touched the
domain-wide delegation entry (Admin console → Security → API controls → Domain-wide delegation;
client ID `105494412978292532522`, scope `gmail.modify`).

**A backfill/miner hangs** → all HubSpot access goes through `src/lib/hubspot.ts` (30s socket
timeout, 429 backoff). Known trap already handled: HubSpot's threads API pages FOREVER (keeps
issuing next-cursors past the end) — the circuit breaker in `analytics-backfill.ts` stops after
3 pages with no unseen threads. Keep that pattern in any new pager.

**Send misbehaving** → recipient/threading logic in `src/lib/channels/gmail.ts` (To header,
RFC In-Reply-To fetched at send time, invalid-thread fallback to new thread). The mock guard:
`providerThreadId` starting `mock-` never transmits. Every send needs a rep click; there is no
auto-send path anywhere.

**"Page couldn't load" / DB unreachable** → the Supabase pooler sits behind an AWS NLB that
intermittently refuses connects for a few seconds (observed 2026-07-02 on both 5432 and 6543,
then 8/8 successes moments later). Two layers of defense are in place: the app runtime uses the
transaction pooler (6543, `pgbouncer=true&connection_limit=10&pool_timeout=20`; session 5432
stays as `DIRECT_URL` for migrations), and `src/lib/db.ts` retries connection-class errors 3×
with backoff on EVERY query. If outages exceed ~2s the page still errors — check
`/root/.pm2/logs/concierge-error.log` and the Supabase status page. Note: rheos-inventory shares
this database project WITHOUT these defenses (59+ PM2 restarts historically) — same fix applies.

**DB inspection** → `npm run db:studio`, or the kept scripts: `scripts/db-setup.cjs`
(provisioning), `scripts/db-sales-load.cjs` (Amazon monthly reload), `scripts/dsp-update.cjs`,
`scripts/db-product-findings.cjs` (cross-tab report in terminal).

## 6. Feature inventory (all live)

- **Multi-user routing (shipped 2026-07-08)** — intake triage (now `claude-sonnet-5`,
  thinking disabled — the forced-tool-choice trap) classifies every real inquiry into the
  canonical fine-grained taxonomy (`src/lib/categories.ts`: warranty, replacement_parts,
  shipping_order_status, returns_exchange, sizing_fit, product_question, wholesale,
  marketing_collab, purchasing_po, escalation, other) stored on `Ticket.category`;
  `src/lib/assign.ts` auto-assigns to the least-loaded user whose `User.specialties`
  matches (unmatched → unassigned triage queue). Admins (brand_admin+) land on the
  importance-ordered all-open view (urgent → needs reply → waiting longest) with a
  per-user workload strip and inline reassign; agents land on **My tickets**. **Team page**
  (`/users`, admin-gated) adds users, sets role + specialties, sends sign-in invites — a
  User row IS the sign-in grant (env `AUTH_ALLOWLIST` is bootstrap-only now). Multi-tenant:
  `getCurrentTenant()` reads the session; same email on several tenants gets a **brand
  switcher** in the header (`/api/tenant/switch` + Auth.js `unstable_update`). Rosters for
  Rheos + Stingray seeded via `npm run db:seed-users`. Intake cron is `*/5 --gated`:
  every 5 min 9am–1pm ET, half-hourly otherwise (gate is inside intake-gmail.ts, DST-safe).
  **Brain training by category + user (shipped 2026-07-08, same day)**: `routeSignalAssignee`
  sends every new LearningSignal to the least-loaded specialist for its category (teach routes
  stamp the ticket's category; the nightly detector uses the majority category of the edited
  drafts' tickets; no specialist → admin's Brain-manager queue). `/training` = each user's
  personal queue (nav badge shows their open count); Brain manager shows category + assignee
  on every signal and filters entries by category.
- **Context notes + expiry review (shipped 2026-07-08, Phase 5)** — `ContextNote` scoped to
  ONE ticket or the customer (all their tickets), optional `expiresAt`. NotesPanel on the
  ticket workspace (scope picker + date) and profile. Unexpired notes feed draft grounding
  as team-vetted facts; the moment one expires it drops out of grounding AND queues on the
  admin inbox: "did what they describe happen?" → Extend 30d / Keep no expiry / Remove.
  No cron — expiry is computed on read, so the queue is always current.
- **Scribe design system (2026-07-08)** — tokens in `globals.css` (`--color-gold #A8882E`,
  cream `#FAF6EC`, warm grey, Arial per ops/scribe-pitch-delivery-style-guide.md);
  `.page-title` (gold ALL-CAPS + hairline underline) on every page; `.btn-primary` gold for
  main CTAs (semantic green/red kept); brand mark `public/scribe-mark.png` (must stay in
  middleware PUBLIC_EXACT or it 307s) + "by Scribe CHS" wordmark in header/login; cream
  group headers; nav marks the active section in gold (NavLinks client component).
- **Customer sales space (shipped 2026-07-08, Phase 4)** — `SalesSource` rows per tenant
  drive the admin `/sources` panel (order counts/revenue derived live from `CustomerOrder`,
  which now carries `tenantId`). Rheos streams: Shopify D2C (nightly), **HubSpot B2B** —
  won-stage deals (probability 1.0, discovered from live pipeline config, NOT hardcoded)
  imported via `import-hubspot-orders` (cron 03:45, `--full` for backfill; 354 deals seeded).
  Stingray slot: Dealers Circle/ERP placeholder, inactive until their data is defined.
  **AI customer read** (`src/lib/customer-insight.ts`, Sonnet 5 thinking-disabled): 2–3
  rep-facing sentences interpreting D2C+B2B history, inquiry pattern, rep-entered channel
  facts, and recent messages; cached on `Customer.insight`, regenerated only when the
  basis counts change, fail-soft (stale beats broken). Shown on ticket + profile, appended
  to draft grounding as tone/context only — policy facts stay Brand-Brain-only.
  `Customer.purchaseChannel/channelName` (direct|retail|dealer + which one) editable on
  the profile ("Buys via"), chipped on the ticket stats strip.
- **Inbox** — My tickets/All open/Noise/All views, fine-grained category chips, wholesale chip, product tags, waiting-days chips, assign dropdowns (admin)
- **Ticket workspace** — clean threaded conversation with image attachments (streamed on demand
  from Gmail), "View original in Gmail" deep link (account-scoped, for additional review), customer key-stats strip (orders, LTV, first/last sale, returns, warranty
  contacts), grounded draft with coverage + citations + policy flags, steer chips + freeform
  regenerate, **submit-for-manager-review**, confirm-and-send (recipient on the button),
  Resolve/Archive, post-send **Save answer to Brand Brain**
- **Teach the Brain** (on the ticket workspace, shipped 2026-07-02) — citations show version +
  provenance (`sourceRef`) so out-of-date sources are identifiable; ✎ on a citation submits a
  correction ("that PO has arrived — no longer in process"), the freeform box submits a net-new
  learning. Claude synthesizes the revised canonical answer (correction) or a titled entry
  (learning); both land as open `LearningSignal`s (`rep_correction` / `rep_learning`) in the
  Brain manager — same human gate as the nightly detector, nothing mutates the Brain directly.
  Repeat corrections on one entry fold into a single open proposal. Approving a `new_entry`
  signal creates an approved KnowledgeItem with `taught on ticket:<id>` provenance.
- **Inbox grouping + bulk archive** (shipped 2026-07-02, Jake's §10) — open view pins an
  "Answer first — urgent" red group; vendor-pitch/automated-looking tickets group at the bottom
  with select-all; multi-select + "Archive selected" archives in Concierge AND drops the
  thread's INBOX label in Gmail (`ChannelAdapter.archiveThread`; single-ticket Archive syncs
  too; mock threads never touch the mailbox; AuditEvent `provider_archived`).
- **Reply-state tags** (shipped 2026-07-02, Jake's §10) — every ticket carries first contact /
  follow-up / waiting on customer, computed deterministically from message directions on read
  (`src/lib/reply-state.ts`), shown in inbox + ticket header, filterable via chips.
- **Urgent-first** (shipped 2026-07-02, Jake's §10) — deterministic urgency floor in triage
  (`urgencyDeterministic`: address changes, cancel/wrong/missing order, urgent/ASAP) plus a
  model instruction; high-priority open tickets pin to the top with an unmissable red URGENT
  treatment. Address changes race against shipment — they surface first.
- **Order context** (shipped 2026-07-02, Jake's §10) — `src/lib/shipstation.ts` (V1 API, same
  creds as rheos-inventory, 10-min cache, fail-soft) pulls the customer's recent orders: placed
  date, status, ship date, carrier, tracking (+ tracking link). Shown as an "Order status"
  strip on the ticket and appended to draft grounding, so shipping/order drafts reference the
  ACTUAL order state. Requires `SHIPSTATION_API_KEY` + `SHIPSTATION_API_SECRET` in `.env`.
- **Reviews** (`/reviews`) — manager queue: approve (unlocks send) or return with a note
- **Brand Brain** (`/brain`) — entries with version + citation counts, pending-approval queue
  (mined FAQ + promoted answers), learning-signal proposals panel
- **Analytics** (`/analytics`) — 365-day classified history: request types, outcome sentiment
  (noise excluded), inquiries-vs-sales overlay, time-from-purchase histogram, drafts-sent-
  unedited KPI, Explore cross-tabs (time×category×sentiment×silhouette×style×color), every
  cell drilling to the underlying inquiries
- **Customer profiles** (`/customers/[id]`) — LTV, full order history, support history with
  per-inquiry sentiment and days-after-purchase, negative-outcome flag
- **Related customers** (`src/lib/related-customers.ts`, panel on the profile) — when a
  customer's email has no (or few) orders, surfaces orders under OTHER emails that share
  their last name (in the email local part or the buyer/ship-to name) or ship to the same
  address as one of their own orders. Powered by buyer + ship-to identity columns on
  CustomerOrder (`buyerName`, `shipName`, `shipAddress1/City/State/Zip`), captured by the
  Shopify import (2026-07-09; the import also stamps `tenantId` now). Heuristic and
  rep-facing only — match reasons are shown, nothing is merged automatically, and a
  too-common surname (>25 name-only hits) suppresses name matches, keeping address hits.
  Example that motivated it: langliekristoffer@gmail.com (0 orders) → klanglie21@gmail.com
  (order #80986).

## PERFORMANCE — the geography problem (read before touching DB config)

**birdseye is in Frankfurt; the Supabase project is in us-west-2 (Oregon). Base RTT ~175ms.**
Discovered 2026-07-08 when ticket pages took 7-9s: the app ran on the TRANSACTION pooler
(6543, `pgbouncer=true`), where Prisma can't use prepared statements — **~843ms per query**
(≈5 round trips each). Fix applied: app runtime moved to the **SESSION pooler (5432,
prepared statements, ~175ms/query, connection_limit=8)** — this partially supersedes the
2026-07-02 "runtime on the transaction pooler" resilience change; the per-query retry
wrapper remains. Layout chrome queries (tenant name, brand list, training badge) are
unstable_cache'd (60s/30s). ShipStation is off the ticket render path (client-fetched);
/tickets/[id]/next pre-warms the next ticket's caches.

**The structural fix is data locality** — either move the Supabase project to eu-central-1
(Frankfurt, same city as the server) or host the app in us-west. Caveat: the project is
SHARED with rheos-inventory (concierge reads `public."Product"` and `public."AmazonOrder"`),
so the whole project moves together, or those dependencies get duplicated. Needs Jake's
call + a maintenance window; the nightly pg_dump + BACKUP-RECOVERY.md make the concierge
half mechanical.

## 7. Known limitations & honest caveats

1. **[FIXED 2026-07-02]** ~~"Unresolved" sentiment is inferred from the customer's last
   message~~ — per Jake's note, sentiment is now judged from the ordered tail of the FULL
   thread (both directions, rep replies included): unresolved only when the customer's last
   message got no rep reply. The fix also uncovered that HubSpot returns thread messages
   NEWEST-first — the original classifier was actually judging the opening inquiry. All
   rows were re-judged (`tsx prisma/analytics-backfill.ts --reclassify all`); the nightly
   cron classifies new threads the same way.
2. **Product-mention coverage ≈ 20%** of real inquiries (explicit mentions only, by design).
3. **[IMPROVED 2026-07-02]** Style/gender attributes now come from Shopify tags PLUS HubSpot's
   SKU-level `rhe_*` properties (silhouette, frametype→wrap/lifestyle, gender, lens size, base
   curve, best-seller tags) per Jake's note — coverage went 13→19 families with style, 2→17
   with gender, and product entries gained Style/Fit/best-seller lines. Still null-honest:
   ~49 families have no attribute in either source (mostly discontinued) and stay null.
   `import-products.ts` also restamps AnalyticsInquiry style/gender each nightly run.
4. **Amazon buyer emails are anonymized** → Amazon orders can't match to support emails;
   time-since-purchase only sees Shopify orders.
5. **Reply playbooks missing** for replacement_parts / returns_exchange / sizing_fit (too few
   API-readable rep replies in positive threads). Retry with relaxed sampling.
6. **Auth roles are soft** — allowlist gates entry; /reviews is not yet role-restricted (any
   signed-in user could approve). Fine at current team size; tighten before adding reps.
7. **Single-tenant hardcode** — `getCurrentTenant()` returns Rheos. The schema is multi-tenant
   throughout; the resolver is the one seam to replace at Stingray onboarding.
8. **Voyage throttle** (no billing card): 3 req/min. Drafting retrieval uses 1 embed call per
   draft — fine solo, will queue with several concurrent reps.
9. **PM2 single instance, no CI** — deploys are manual/rsync; GitHub is source-of-truth but
   nothing auto-deploys on push.

## FUTURE: returns & exchange process (Jake-approved direction, 2026-07-08)

Build the return/exchange flow INTO the ticket workspace, staged so each phase ships value:

**Phase A — guided returns (no new integrations).** A "Start return/exchange" action on
returns_exchange tickets: eligibility check runs automatically against data we already
have (their order from CustomerOrder/ShipStation, purchase date vs the 365-day Saltwater
Promise, refund history, the AI customer read for abuse signals). Output = an eligibility
verdict + a pre-filled reply (return instructions / exchange offer) grounded in the Brain's
return policy. The rep confirms and sends, and the ticket gains a `return_started` state.

**Phase B — label + tracking.** Generate the return label via ShipStation (we already have
API creds; POST /shipments/createlabel) or Shopify's return APIs, attach it to the outgoing
reply, and track the inbound package — the likely-handled detector grows a "return package
delivered" signal that surfaces the ticket for refund action.

**Phase C — money movement.** Refund or exchange execution via the Shopify Admin API
(client-credentials app already minted — needs write_orders scope added). ALWAYS
human-confirmed, same as send: Concierge prepares, a rep clicks. Exchange = draft order +
refund; refund = refund API against the original transaction. Audit every step.

**Data notes:** Ticket gains returnStatus (requested → approved → label_sent →
package_received → refunded/exchanged); the digest gets a returns-in-flight tile; analytics
already tracks returns_exchange categories + refund flags for the KPI side.
**Decision points for Jake:** whether exchanges ship before the return lands (trust
tiers by customer LTV — the customer read can gate this), restocking-fee policy, and
whether B2B/wholesale returns follow the same flow or route to jake@.

## 8. Roadmap suggestions (in rough priority)

1. **Dogfood week** — run real Rheos support in it; the acceptance KPI + learning signals only
   get meaningful with volume.
2. **Role-gate /reviews + add reps** to `AUTH_ALLOWLIST`; set `role` on their User rows.
3. **Vision on warranty photos** — Opus can look at the attached images and pre-assess claims.
4. **Rules engine UI** — the `Rule` model exists; triage is currently code+model.
5. **Gmail label sync-back** (adapter methods exist, unwired) — mirror Concierge state into the
   mailbox for anyone still working in Gmail.
6. **Stingray tenant** — Azure app registration, wire `GraphMailAdapter`, tenant resolver.
7. **CI/CD** — GitHub Action → rsync+deploy on push to main (pattern exists in firstdraft repo).

## 9. Data provenance (for trust in the analytics)

- Inquiries: HubSpot conversation threads, 365 days, classified by Haiku in batches
  (category + end-of-exchange sentiment), threadId-deduped, resume-safe. Sentiment reads the
  ordered full-thread tail. **Trap: HubSpot's thread-messages API returns NEWEST-first — always
  sort by createdAt before treating anything as "first" or "last".**
- Sales: Shopify Admin API full history (client-credentials mint) + Amazon from
  `public."AmazonOrder"` (rheos-inventory's 30-min sync). Refunds from `financial_status`.
- Purchase matching: inquiry email ↔ most recent prior order, computed in SQL
  (`scripts/dsp-update.cjs`); 681/2,588 matched.
- Product mentions: deterministic string match against `ProductFamily` (no LLM, no guessing);
  colorway words blocklisted after the "Tortoise" phantom-family incident.
