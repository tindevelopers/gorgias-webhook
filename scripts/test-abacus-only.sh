#!/usr/bin/env bash
# Unit test: Abacus getChatResponse only (no Gorgias).
# Same as app: POST .../api/getChatResponse?deploymentToken=...&deploymentId=...
# Requires: ABACUS_DEPLOYMENT_TOKEN, ABACUS_DEPLOYMENT_ID

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
if [ -f "$ROOT_DIR/.env.local" ]; then
  set -a
  # shellcheck source=/dev/null
  . "$ROOT_DIR/.env.local"
  set +a
fi

MARKER="${1:-PSD_OK_123}"
BASE="${ABACUS_API_BASE_URL:-https://apps.abacus.ai}"
BASE="${BASE%/}"
URL="${BASE}/api/getChatResponse?deploymentToken=${ABACUS_DEPLOYMENT_TOKEN:?Set ABACUS_DEPLOYMENT_TOKEN}&deploymentId=${ABACUS_DEPLOYMENT_ID:?Set ABACUS_DEPLOYMENT_ID}"

echo "Abacus-only test (getChatResponse): expect reply to contain: $MARKER"
echo "POST $URL"
curl -s -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d "{
    \"messages\": [{\"text\": \"Reply with exactly: $MARKER\", \"is_user\": true}],
    \"temperature\": 0.0
  }"
echo ""
echo "--- Pass if Abacus reply contains $MARKER (or clearly acknowledges it)."
