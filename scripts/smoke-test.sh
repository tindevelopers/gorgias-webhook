#!/usr/bin/env bash
# Local smoke test: POST a fake Gorgias payload to the webhook (no real Gorgias/Abacus).
# Run with: npm run dev (in one terminal), then: ./scripts/smoke-test.sh

set -e
BASE="${BASE_URL:-http://localhost:3000}"
URL="${BASE}/api/webhooks/gorgias"

echo "Smoke test: POST $URL"
curl -i -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "message_created",
    "ticket": { "id": 123, "customer": { "email": "customer@example.com" } },
    "message": {
      "id": 456,
      "body_text": "Hello — smoke test",
      "from_agent": false,
      "sender": { "email": "customer@example.com" }
    }
  }'
echo ""
