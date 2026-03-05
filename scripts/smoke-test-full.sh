#!/usr/bin/env bash
# Complete smoke test: route → Abacus → Gorgias (end-to-end).
# 1) Dry-run (route only)
# 2) Abacus-only (optional, quick)
# 3) Full e2e with REAL_TICKET_ID (webhook → Abacus → Gorgias)
# Usage: REAL_TICKET_ID=123456789 ./scripts/smoke-test-full.sh
#        Or run without REAL_TICKET_ID to test only steps 1–2 (e2e will fail at Gorgias if ticket invalid).

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"
if [ -f ".env.local" ]; then
  set -a
  # shellcheck source=/dev/null
  . .env.local
  set +a
fi

BASE_URL="${BASE_URL:-http://localhost:3000}"
URL="${BASE_URL}/api/webhooks/gorgias"

echo "=============================================="
echo "  COMPLETE SMOKE TEST (end-to-end)"
echo "=============================================="

# 1) Dry run (route + parsing, no Abacus/Gorgias)
echo ""
echo "--- 1) Smoke test (DRY_RUN=true): route only ---"
export DRY_RUN=true
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "message_created",
    "ticket": { "id": 123, "customer": { "email": "customer@example.com" } },
    "message": { "id": 456, "body_text": "Hello", "from_agent": false, "sender": { "email": "c@example.com" } }
  }'
echo "Expected: HTTP 200"

# 2) Full e2e (DRY_RUN=false): webhook → Abacus → Gorgias
REAL_TICKET_ID="${REAL_TICKET_ID:-}"
if [ -z "$REAL_TICKET_ID" ]; then
  echo ""
  echo "--- 2) Full e2e: skipped (set REAL_TICKET_ID to run) ---"
  echo "Example: REAL_TICKET_ID=<your_ticket_id> ./scripts/smoke-test-full.sh"
  exit 0
fi

echo ""
echo "--- 2) Full e2e: webhook → Abacus → Gorgias (ticket $REAL_TICKET_ID) ---"
export DRY_RUN=false
MSG_ID="${MSG_ID:-999$(date +%s | tail -c 5)}"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d "{
    \"event\": \"message_created\",
    \"ticket\": { \"id\": $REAL_TICKET_ID, \"customer\": { \"email\": \"customer@example.com\" } },
    \"message\": {
      \"id\": $MSG_ID,
      \"body_text\": \"E2E smoke test: please reply with OK\",
      \"from_agent\": false,
      \"sender\": { \"email\": \"customer@example.com\" }
    }
  }")
HTTP_CODE=$(echo "$RESP" | tail -n1)
BODY=$(echo "$RESP" | sed '$d')
echo "HTTP $HTTP_CODE"
echo "$BODY" | head -c 500
echo ""
echo "Expected: HTTP 200, { \"success\": true }; check Gorgias ticket $REAL_TICKET_ID for the reply."
echo "=============================================="
