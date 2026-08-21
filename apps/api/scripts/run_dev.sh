#!/bin/sh
# Local development API only. Refuses hop-uokqmg. Bind 0.0.0.0 for a physical iPhone.
set -eu
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

export APP_ENV="${APP_ENV:-development}"
export DATABASE_URL="${DATABASE_URL:-postgresql+psycopg://hop@localhost:5432/hop}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
export ENABLE_DEV_RATE_LIMIT_RESET="${ENABLE_DEV_RATE_LIMIT_RESET:-true}"
export CORS_ORIGINS="${CORS_ORIGINS:-http://localhost:8081,http://127.0.0.1:8081}"
export API_HOST="${API_HOST:-0.0.0.0}"
export API_PORT="${API_PORT:-8000}"

case "$DATABASE_URL" in
  *hop-uokqmg*)
    echo "Refusing hop-uokqmg DATABASE_URL. This script is for local Postgres only." >&2
    exit 2
    ;;
esac

echo "HOP API DEV  APP_ENV=${APP_ENV}  DATABASE_URL=localhost  REDIS_URL=localhost  (not hop-uokqmg)"
if [ -x .venv/bin/uvicorn ]; then
  exec .venv/bin/uvicorn app.main:app --reload --host "$API_HOST" --port "$API_PORT"
fi
exec uvicorn app.main:app --reload --host "$API_HOST" --port "$API_PORT"
