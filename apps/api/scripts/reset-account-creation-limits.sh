#!/bin/sh
# Development/test API only. Clears the *request source IP* register-device mint
# bucket (and install bucket if X-Hop-Install is set). Refuses hop-uokqmg.fly.dev.
# Usage: ./scripts/reset-account-creation-limits.sh [API_ORIGIN]
set -eu

PRODUCTION_HOST="hop-uokqmg.fly.dev"
RESET_PATH="/auth/dev/reset-account-creation-limits"

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  cat <<'EOF'
Clear register-device mint counters on a local/test HOP API (not production).

  cd apps/api
  npm run reset:account-creation-limits
  ./scripts/reset-account-creation-limits.sh
  ./scripts/reset-account-creation-limits.sh http://127.0.0.1:8000

Origin resolution (first wins): argv[1], HOP_API_URL, EXPO_PUBLIC_API_URL,
then http://127.0.0.1:8000.

This POST is keyed by the *client IP of this curl*. It does not clear an
iPhone's cellular/Wi-Fi bucket. For a physical phone, point Metro
EXPO_PUBLIC_API_URL at this LAN API and use the hidden __DEV__ diagnostics
control on the phone (sends X-Hop-Install from that device).

Refuses https://hop-uokqmg.fly.dev. Production leaves ENABLE_DEV_RATE_LIMIT_RESET off.

Optional:
  HOP_INSTALL_HASH     64-char hex X-Hop-Install value
  DEV_RATE_LIMIT_RESET_KEY   sent as X-Hop-Dev-Reset-Key when the test API has a key
EOF
  exit 0
fi

API_URL="${1:-${HOP_API_URL:-${EXPO_PUBLIC_API_URL:-http://127.0.0.1:8000}}}"
API_URL="${API_URL%/}"

case "$API_URL" in
  *"$PRODUCTION_HOST"*)
    echo "Refusing ${PRODUCTION_HOST}. This command is for a local/test API only (APP_ENV=development)." >&2
    echo "Production hop-uokqmg keeps the 5 new accounts / IP / 24h limiter. Do not set ENABLE_DEV_RATE_LIMIT_RESET on Fly." >&2
    echo "Point EXPO_PUBLIC_API_URL at http://<MAC_LAN_IP>:8000 and reset from the iPhone, or curl that LAN API from the same source IP you need cleared." >&2
    exit 2
    ;;
esac

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required" >&2
  exit 1
fi

HEADERS="-H Accept: application/json"
if [ -n "${HOP_INSTALL_HASH:-}" ]; then
  HEADERS="$HEADERS -H X-Hop-Install: ${HOP_INSTALL_HASH}"
fi
if [ -n "${DEV_RATE_LIMIT_RESET_KEY:-}" ]; then
  HEADERS="$HEADERS -H X-Hop-Dev-Reset-Key: ${DEV_RATE_LIMIT_RESET_KEY}"
fi

echo "POST ${API_URL}${RESET_PATH}"
echo "Clears the mint bucket for THIS curl's source IP (not an iPhone's IP unless this request comes from that phone)."

# shellcheck disable=SC2086
response="$(curl -sS -w '\n%{http_code}' -X POST ${HEADERS} "${API_URL}${RESET_PATH}")" || {
  echo "Request failed. Is the local API running?  cd apps/api && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000" >&2
  exit 1
}

http_code="$(printf '%s' "$response" | tail -n 1)"
body="$(printf '%s' "$response" | sed '$d')"

printf '%s\n' "$body"
if [ "$http_code" -lt 200 ] || [ "$http_code" -ge 300 ]; then
  echo "HTTP ${http_code}" >&2
  if [ "$http_code" = "404" ]; then
    echo "This origin is not a development reset target (flag off, or not the local API)." >&2
  fi
  exit 1
fi
