# Backup & recovery — Concierge

What is protected, where it lives, and exactly how to get it back.
Last verified: 2026-07-08 (test dump restored-parseable, integrity-checked).

## What gets backed up, and where

| Asset | Protection | Where | Retention |
|---|---|---|---|
| **Database** (`concierge` schema: tickets, messages, Brain, customers, orders, audit ledger) | Nightly `pg_dump` at 02:00 UTC (`scripts/backup-db.sh`) | `/root/backups/concierge/concierge-YYYYMMDD.sql.gz` on birdseye (72.61.177.29) | 14 days |
| Database (platform-level) | Supabase's own automated backups on the project (`xivgoqvmfmlfsedisnxf`) | Supabase dashboard → Database → Backups | per Supabase plan |
| **Server secrets** (`/opt/concierge/.env` — the only unversioned file) | Copied nightly next to the dump (`env-YYYYMMDD.bak`, mode 600) | same directory | 14 days |
| **Code** | git | github.com/jakeb0429/concierge (private) + local clone | full history |
| **Email bodies & attachments** | Gmail itself is the source of truth — the DB stores text + attachment metadata; bytes stream from Gmail on demand | hello@/wholesale@rheosgear.com mailboxes | Google |
| **Not covered here** | `public` schema tables (`Product`, `AmazonOrder`) belong to rheos-inventory and rebuild from Shopify/Amazon syncs; ProductFamily and Brain product entries rebuild via `npm run db:import-products` | — | — |

## Restore: single table or rows (most common case)

```bash
# On birdseye — extract just the table you need from the newest dump:
zcat /root/backups/concierge/concierge-$(date +%Y%m%d).sql.gz \
  | awk '/^COPY concierge."KnowledgeItem"/,/^\\\.$/' > /tmp/knowledge-rows.sql
# Review, then apply selectively with psql against the DIRECT_URL (session pooler).
```

## Restore: full schema (disaster)

```bash
# 1. New/empty Supabase project (or the same one after wiping the schema):
#    ensure pgvector: CREATE EXTENSION IF NOT EXISTS vector SCHEMA extensions;
# 2. Recreate the schema + extension idempotently:
cd /opt/concierge && node scripts/db-setup.cjs
# 3. Load the dump (client 17 binary matters — server is PG 17):
DIRECT_URL=$(grep -m1 '^DIRECT_URL=' /opt/concierge/.env | cut -d= -f2- | tr -d '"' | cut -d'?' -f1)
zcat /root/backups/concierge/concierge-YYYYMMDD.sql.gz \
  | /usr/lib/postgresql/17/bin/psql "$DIRECT_URL"
# 4. If restoring into a NEW Supabase project: update DATABASE_URL/DIRECT_URL in
#    /opt/concierge/.env (session vs transaction pooler ports 5432/6543), then
#    bash /opt/concierge/scripts/deploy-birdseye.sh
```

## Restore: server itself dies

1. New Ubuntu box: install node 20, pm2, nginx, certbot, postgresql-client-17.
2. `git clone git@github.com:jakeb0429/concierge.git /opt/concierge`
3. Restore `.env` from the newest `env-*.bak` (or rebuild from the credentials map in docs/HANDOFF.md §4).
4. `bash /opt/concierge/scripts/deploy-birdseye.sh` (installs build, pm2, nginx vhost, all crons).
5. Point the `concierge.scribechs.com` A record at the new IP; run the certbot line the deploy script prints.

## Verifying backups are healthy

- `tail /root/concierge-backup.log` — one "ok" line per night with the dump size.
- `gunzip -t /root/backups/concierge/concierge-*.sql.gz` — integrity.
- Sizes should grow slowly (~4MB as of 2026-07-08); a sudden shrink = investigate before trusting it.

## Known gaps (accepted, revisit as the client base grows)

- Backups live on the same box as the app. Off-box copies (e.g. rsync to another
  host or object storage) are the next hardening step if Concierge becomes
  multi-client-critical.
- The dump excludes `public` schema data owned by rheos-inventory (rebuildable).
- 14-day window: an unnoticed data problem older than two weeks relies on
  Supabase's platform backups.
