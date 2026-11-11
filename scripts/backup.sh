#!/usr/bin/env bash
# Nightly backup (scope §17): pg_dump -Fc to the HDD, 14 dailies + 8 weeklies,
# then restic to an off-machine target when RESTIC_REPOSITORY is set.
# Env: DATABASE_URL, BACKUP_DIR, optional RESTIC_REPOSITORY / RESTIC_PASSWORD_FILE.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/mnt/data/miniasys/backups}"
: "${DATABASE_URL:?DATABASE_URL is required}"
mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly"

stamp="$(date +%Y-%m-%d_%H%M)"
file="$BACKUP_DIR/daily/platform_$stamp.dump"

# pg_dump from the Postgres container when the host has none
if command -v pg_dump >/dev/null 2>&1; then
  pg_dump -Fc --no-owner "$DATABASE_URL" > "$file.tmp"
else
  podman exec -i "${PG_CONTAINER:-infra_postgres_1}" pg_dump -Fc --no-owner -U platform platform > "$file.tmp"
fi
mv "$file.tmp" "$file"

# Sunday's dump is also a weekly
if [ "$(date +%u)" = "7" ]; then cp "$file" "$BACKUP_DIR/weekly/"; fi

ls -1t "$BACKUP_DIR"/daily/*.dump 2>/dev/null | tail -n +15 | xargs -r rm --
ls -1t "$BACKUP_DIR"/weekly/*.dump 2>/dev/null | tail -n +9 | xargs -r rm --

if [ -n "${RESTIC_REPOSITORY:-}" ]; then
  restic backup --quiet --tag miniasys "$BACKUP_DIR" "${LAKEHOUSE_CATALOG:-$HOME/miniasys/lakehouse/catalog.duckdb}" || echo "restic failed" >&2
  restic forget --quiet --tag miniasys --keep-daily 14 --keep-weekly 8 --prune || true
fi

echo "backup ok: $file ($(du -h "$file" | cut -f1))"
