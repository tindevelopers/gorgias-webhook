#!/usr/bin/env bash
# Unit test: Gorgias API only (post a message to a ticket). No Abacus.
# Confirms Gorgias API credentials.
# Requires: GORGIAS_EMAIL, GORGIAS_API_KEY, GORGIAS_DOMAIN, TICKET_ID
# Usage: TICKET_ID=123456789 ./scripts/test-gorgias-only.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
if [ -f "$ROOT_DIR/.env.local" ]; then
  set -a
  # shellcheck source=/dev/null
  . "$ROOT_DIR/.env.local"
  set +a
fi

TICKET_ID="${TICKET_ID:?Set TICKET_ID (e.g. from a test ticket in Gorgias)}"
RAW_DOMAIN="${GORGIAS_DOMAIN:?Set GORGIAS_DOMAIN (e.g. pawpointers or https://pawpointers.gorgias.com)}"
# Accept subdomain (pawpointers) or full URL; extract subdomain for building API URL
if [[ "$RAW_DOMAIN" == *"gorgias.com"* ]]; then
  DOMAIN="${RAW_DOMAIN#*://}" && DOMAIN="${DOMAIN%%.gorgias.com*}"
else
  DOMAIN="$RAW_DOMAIN"
fi
URL="https://${DOMAIN}.gorgias.com/api/tickets/${TICKET_ID}/messages"

echo "Gorgias-only test: posting to ticket $TICKET_ID"
echo "POST $URL"
curl -i -X POST "$URL" \
  -u "${GORGIAS_EMAIL:?Set GORGIAS_EMAIL}:${GORGIAS_API_KEY:?Set GORGIAS_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "body": "Gorgias API test: GORGIAS_OK_123",
    "from_agent": true
  }'
echo ""
echo "--- Pass if you see the message in that ticket in Gorgias."
