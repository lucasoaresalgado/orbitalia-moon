#!/usr/bin/env bash
# Restore drill (scope §17): restores a dump into a SCRATCH database and runs a
# smoke query. It never touches the live database.
# Usage: scripts/restore.sh [dump file]   (default: the latest daily dump)
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/mnt/data/miniasys/backups}"
: "${DATABASE_URL:?DATABASE_URL is required (the server to restore into)}"
dump="${1:-$(ls -1t "$BACKUP_DIR"/daily/*.dump | head -n1)}"
scratch="platform_restore_$(date +%Y%m%d%H%M)"
admin_url="${DATABASE_URL%/*}/postgres"

echo "restoring $dump into $scratch"
psql "$admin_url" -v ON_ERROR_STOP=1 -c "CREATE DATABASE $scratch"
trap 'psql "$admin_url" -c "DROP DATABASE IF EXISTS $scratch" >/dev/null' EXIT
pg_restore --no-owner -d "${DATABASE_URL%/*}/$scratch" "$dump"

# smoke test: the core tables are there and readable
psql "${DATABASE_URL%/*}/$scratch" -v ON_ERROR_STOP=1 -At -c "
  SELECT 'projects', count(*) FROM projects UNION ALL
  SELECT 'cards', count(*) FROM cards UNION ALL
  SELECT 'runs', count(*) FROM runs UNION ALL
  SELECT 'llm_calls', count(*) FROM llm_calls UNION ALL
  SELECT 'agents', count(*) FROM agents"
echo "restore drill ok (scratch database dropped on exit)"
