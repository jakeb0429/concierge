# Concierge — conventions for Claude Code sessions

Tier 2 project under `iCloud/Claude/DEVELOPMENT-STANDARDS.md` (client-paid; treat
sensitive paths at Tier 3 rigor). Read `docs/HANDOFF.md` for architecture and
runbooks; `docs/BACKUP-RECOVERY.md` for restore paths.

## Commands

- `npm run dev` — dev server on :3014 (run via shell, not preview tools — iCloud path quirk)
- `npm run predeploy-check` — typecheck → lint → test → build. **Required green before any deploy.**
- `npm run test` / `test:watch` — Vitest; tests live in `tests/` mirroring `src/`
- Deploy: `rsync` source to birdseye then `ssh root@72.61.177.29 'bash /opt/concierge/scripts/deploy-birdseye.sh'`

## Database changes — migrations only

`db push` is **banned** against the shared DB (it's production). The flow:

1. Edit `prisma/schema.prisma`
2. `npm run db:migrate:new > prisma/migrations/$(date +%Y%m%d%H%M%S)_<name>/migration.sql`
3. Review the SQL (destructive changes ship one release after code stops using the columns)
4. `npm run db:migrate:deploy` (uses DIRECT_URL, the session pooler)

Baseline `000000000000_baseline` was resolved against the live DB on 2026-07-08.
Fresh-DB restores: run `node scripts/db-setup.cjs` first (schema + pgvector), then
`db:migrate:deploy`, then restore data per `docs/BACKUP-RECOVERY.md`.

## Non-negotiables (from the standards doc)

- **Every API route** validates input via `parseBody`/`parseQuery` (`src/lib/validate.ts`, zod)
  and scopes every DB lookup by the session tenant (`getCurrentTenant()`); role gates via
  `src/lib/roles.ts`. New route = same-session happy-path + auth-rejection test.
- **No `console.*` in `src/`** (lint-enforced) — use `logger`/`requestLogger` from
  `src/lib/log.ts`. Cron scripts under `prisma/`/`scripts/` may console-log (they pipe to
  files); migrate them to pino when touched.
- **Outbound HTTP is bounded**: timeout + failure handling on every third-party call
  (ShipStation/HubSpot/Mailgun/Voyage patterns in `src/lib/`). Never a bare fetch.
- **Maintenance scripts are idempotent** — safe to run twice; upserts and watermarks,
  never blind inserts.
- **Audit everything sensitive** — writes to tickets/Brain/users/notes create `AuditEvent`
  rows from the route layer (see `/audit` page).

## Environment / infra facts that bite

- App runtime DB = **session pooler** (5432, `connection_limit=6` prod / 3 dev). The
  supavisor session pool caps at 15 clients across app + crons + dev. Never raise limits
  past that budget. Transaction pooler (6543) is ~5x slower per query (no prepared
  statements at 175ms RTT — server is Frankfurt, DB Oregon).
- Drafts: facts go in `liveContext[]` (trusted section), never appended to customer text.
  Em dashes are banned in customer replies (prompt + scrubber in `src/lib/brain/draft.ts`).
- In-memory rate limiter (magic-link) and ShipStation cache are valid **only because PM2
  runs a single process** — note stays until/unless we scale out.

## Standards checklist (retrofit 2026-07-08)

- [x] `.env.example` committed; `.env` gitignored
- [x] TypeScript strict; eslint (flat config, `no-console` in src)
- [x] `src/lib/validate.ts` (zod) wired into every route
- [x] Vitest: money-path + route-gate + domain tests in `tests/`
- [x] Structured logger (`src/lib/log.ts`, pino)
- [x] Prisma migrations from baseline; `db:push` disabled
- [x] CI: typecheck → lint → test → build (`.github/workflows/ci.yml`)
- [x] Deploy script with healthcheck (deploy-birdseye.sh) + nightly backups + restore doc
- [ ] Sentry (decide when Stingray onboards — Tier 3 trigger)
