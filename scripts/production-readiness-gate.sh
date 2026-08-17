#!/usr/bin/env bash
# Production-readiness software gate for integration/production-stabilization.
# Does NOT claim BLE/PTT hardware validation. Hardware checks must stay manual.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
FAIL=0

log() { printf '%s\n' "$*"; }
fail() { printf 'GATE FAIL: %s\n' "$*" >&2; FAIL=1; }

search() {
  grep -R -n -E "$1" "${@:2}" 2>/dev/null || true
}

log "== protocol tests =="
(cd packages/protocol && npm test -- --run) || fail "protocol tests"

log "== API tests =="
if [[ -x apps/api/.venv/bin/pytest ]]; then
  (cd apps/api && .venv/bin/pytest) || fail "API tests"
else
  (cd apps/api && pytest) || fail "API tests"
fi

log "== mobile typecheck =="
if [[ ! -d packages/protocol/node_modules ]]; then
  (cd packages/protocol && npm ci)
fi
if [[ ! -d apps/mobile/node_modules ]]; then
  (cd apps/mobile && npm ci)
fi
(cd apps/mobile && npm run typecheck) || fail "mobile typecheck"

log "== static production guards =="

if search 'Field\(default=.*CHANGE_ME' apps/api/app --include '*.py' | grep -q .; then
  fail "CHANGE_ME used as a Settings default in production code"
fi

if search 'default="CHANGE_ME"|default='\''CHANGE_ME'\''' apps/api/app apps/mobile --include '*.py' --include '*.ts' --include '*.tsx' | grep -v node_modules | grep -q .; then
  fail "CHANGE_ME used as a literal default"
fi

if ! grep -q 'CORS_ORIGINS must be an explicit allow-list' apps/api/app/config.py; then
  fail "production CORS allow-list guard missing"
fi

if ! grep -q 'API_PUBLIC_URL must be HTTPS in production' apps/api/app/config.py; then
  fail "production API_PUBLIC_URL HTTPS guard missing"
fi

if ! grep -q 'createProductionAppTransportManager' apps/mobile/src/hopRuntime.ts; then
  fail "hopRuntime must use createProductionAppTransportManager"
fi

if search 'encodeUnencryptedText|alg: none|alg:none' apps/mobile/src apps/mobile/app --include '*.ts' --include '*.tsx' | grep -q .; then
  fail "insecure crypto fallback referenced on the mobile app path"
fi

if search 'createRelayTransport|from \"./simulatedNetwork|from '\''./simulatedNetwork' apps/mobile/src/hopRuntime.ts | grep -q .; then
  fail "production mock/relay transport registered in hopRuntime"
fi

if ! grep -q 'isBoxedEnvelopePayload' packages/protocol/src/transportManager.ts; then
  fail "TransportManager send path missing boxed-payload refuse"
fi

if ! grep -q 'SERVER_KEY_LOCKED' packages/protocol/src/identityLifecycle.ts; then
  fail "identity regression helpers missing"
fi

if ! grep -q 'verifyAuthenticatedHandshake' packages/protocol/src/bleHandshake.ts; then
  fail "authenticated BLE handshake missing"
fi

if [[ "$FAIL" -ne 0 ]]; then
  log "Production-readiness gate failed."
  exit 1
fi

log "Production-readiness gate passed (software only; no hardware claim)."
exit 0
