#!/usr/bin/env bash
# Full local e2e: curl → webhook → Abacus → Gorgias.
# Use a real ticket id so the post-back to Gorgias succeeds.
# Requires: DRY_RUN not set (or false), real Abacus + Gorgias credentials in .env.local
# Usage: REAL_TICKET_ID=123456789 ./scripts/test-webhook-e2e.sh
# Optional: BASE_URL=http://localhost:3000 (default)

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
if [ -f "$ROOT_DIR/.env.local" ]; then
  set -a
  # shellcheck source=/dev/null
  . "$ROOT_DIR/.env.local"
  set +a
fi

REAL_TICKET_ID="${REAL_TICKET_ID:?Set REAL_TICKET_ID (real Gorgias ticket id)}"
BASE_URL="${BASE_URL:-http://localhost:3000}"
URL="${BASE_URL}/api/webhooks/gorgias"

# Unique message id so dedupe doesn't block a re-run
MSG_ID="${MSG_ID:-999001}"

echo "Full e2e test: webhook → Abacus → Gorgias (ticket $REAL_TICKET_ID)"
echo "POST $URL"
curl -i -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d "{
    \"event\": \"message_created\",
    \"ticket\": { \"id\": $REAL_TICKET_ID, \"customer\": { \"email\": \"customer@example.com\" } },
    \"message\": {
      \"id\": $MSG_ID,
      \"body_text\": \"Say exactly: FULL_OK_123\",
      \"from_agent\": false,
      \"sender\": { \"email\": \"customer@example.com\" }
    }
  }"
echo ""
echo "--- Pass: 200 + { success: true }; logs show INBOUND, ABACUS_CALL_OK, GORGIAS_POST_OK; ticket gets reply with FULL_OK_123."
