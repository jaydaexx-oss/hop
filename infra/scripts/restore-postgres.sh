#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 /backups/hop-YYYYMMDDTHHMMSSZ.sql.gz" >&2
  exit 1
fi

FILE="$1"
if [ ! -f "${FILE}" ]; then
  echo "Backup file not found: ${FILE}" >&2
  exit 1
fi

echo "Restoring from ${FILE}"
echo "This replaces data in database ${PGDATABASE} on ${PGHOST}."
gunzip -c "${FILE}" | psql -v ON_ERROR_STOP=1 -1
