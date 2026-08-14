#!/bin/sh
set -eu

echo "Running database migrations..."
alembic upgrade head

WORKERS="${UVICORN_WORKERS:-2}"
echo "Starting HOP API (workers=${WORKERS})..."
exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port 8000 \
  --workers "${WORKERS}" \
  --proxy-headers \
  --forwarded-allow-ips="${FORWARDED_ALLOW_IPS:-127.0.0.1}"
