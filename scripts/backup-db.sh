#!/usr/bin/env bash
# Nightly Concierge backup — dumps the `concierge` schema from Supabase to
# local disk with 14-day rotation, plus a copy of the server .env (the only
# unversioned file). Belt-and-braces on top of Supabase's own backups:
# a restorable copy that WE control, on a box WE control.
#
# Cron: 0 2 * * * bash /opt/concierge/scripts/backup-db.sh >> /root/concierge-backup.log 2>&1
# Restore runbook: docs/BACKUP-RECOVERY.md
set -euo pipefail

BACKUP_DIR=/root/backups/concierge
PG_DUMP=/usr/lib/postgresql/17/bin/pg_dump # must match server major (PG 17)
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# DIRECT_URL = the session pooler (5432); pg_dump can't run on the transaction
# pooler. Prisma-style query params (?schema=...) are stripped — pg_dump rejects them.
DIRECT_URL=$(grep -m1 '^DIRECT_URL=' /opt/concierge/.env | cut -d= -f2- | tr -d '"' | cut -d'?' -f1)
STAMP=$(date +%Y%m%d)

"$PG_DUMP" "$DIRECT_URL" --schema=concierge --no-owner --no-privileges \
  | gzip > "$BACKUP_DIR/concierge-$STAMP.sql.gz.tmp"
mv "$BACKUP_DIR/concierge-$STAMP.sql.gz.tmp" "$BACKUP_DIR/concierge-$STAMP.sql.gz"

cp /opt/concierge/.env "$BACKUP_DIR/env-$STAMP.bak"
chmod 600 "$BACKUP_DIR"/env-*.bak

# 14-day rotation
find "$BACKUP_DIR" -name 'concierge-*.sql.gz' -mtime +14 -delete
find "$BACKUP_DIR" -name 'env-*.bak' -mtime +14 -delete

echo "$(date -Is) ok $(du -h "$BACKUP_DIR/concierge-$STAMP.sql.gz" | cut -f1) $(ls "$BACKUP_DIR" | wc -l) files retained"
