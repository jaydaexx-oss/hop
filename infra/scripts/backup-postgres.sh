#!/bin/sh
set -eu

TS="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="/backups/hop-${TS}.sql.gz"

echo "Creating backup ${FILE}"
pg_dump --no-owner --no-acl | gzip > "${FILE}"
echo "Backup written: ${FILE}"

if [ -n "${BACKUP_RETENTION_DAYS:-}" ]; then
  find /backups -name 'hop-*.sql.gz' -mtime +"${BACKUP_RETENTION_DAYS}" -delete || true
fi
