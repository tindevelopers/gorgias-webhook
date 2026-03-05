#!/usr/bin/env bash
# Test the deployed Railway (or other) webhook endpoint.
# Usage: ./scripts/test-production.sh [BASE_URL]
# Default BASE_URL: https://gorgias-webhook-production.up.railway.app

set -e
BASE="${1:-https://gorgias-webhook-production.up.railway.app}"
URL="${BASE}/api/webhooks/gorgias"

echo "Testing deployed endpoint: $URL"
echo ""

echo "1) GET (expect 405 Method Not Allowed)"
code=$(curl -s -o /dev/null -w "%{http_code}" "$URL")
echo "   HTTP $code"
[ "$code" = "405" ] && echo "   OK" || echo "   Unexpected"

echo ""
echo "2) POST (webhook payload)"
curl -s -w "\n   HTTP %{http_code}\n" -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "message_created",
    "ticket": { "id": 123, "customer": { "email": "customer@example.com" } },
    "message": {
      "id": 456,
      "body_text": "Production smoke test",
      "from_agent": false,
      "sender": { "email": "customer@example.com" }
    }
  }'
echo ""
echo "Expected: 200 with success (or dry_run), or 500 if Gorgias ticket 123 does not exist."
