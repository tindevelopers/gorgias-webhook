#!/usr/bin/env bash
# Push .env.local variables to Railway (service: gorgias-webhook).
# Prerequisites: railway login, railway link (from project root).
# Run from project root: ./scripts/railway-push-env.sh
# Optional: RAILWAY_SERVICE=my-service ./scripts/railway-push-env.sh
# Values are trimmed: no leading/trailing spaces or newlines.

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env.local"
SERVICE="${RAILWAY_SERVICE:-gorgias-webhook}"

# Trim leading and trailing whitespace + CR/LF; output result (for use with $(trim "$x"))
trim() {
  local v="$1"
  v="${v//$'\r'/}"
  v="${v#"${v%%[![:space:]]*}"}"
  v="${v%"${v##*[![:space:]]}"}"
  printf '%s' "$v"
}

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing .env.local"
  exit 1
fi

cd "$ROOT_DIR"
if ! railway whoami &>/dev/null; then
  echo "Not logged in to Railway. Run: railway login"
  exit 1
fi

if ! railway status &>/dev/null; then
  echo "Project not linked. From project root run: railway link"
  echo "  (choose project and service, or: railway link -p PROJECT_ID -s $SERVICE -e production)"
  exit 1
fi

echo "Pushing variables from .env.local to Railway (service: $SERVICE)..."
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%%#*}"
  line=$(trim "$line")
  [ -z "$line" ] && continue
  if [[ "$line" == *=* ]]; then
    key="${line%%=*}"
    key=$(trim "$key")
    value="${line#*=}"
    value=$(trim "$value")
    value="${value#\"}"
    value="${value%\"}"
    value=$(trim "$value")
    [ -z "$key" ] && continue
    echo "  Setting $key"
    printf '%s' "$value" | railway variable set "$key" --stdin -s "$SERVICE"
  fi
done < "$ENV_FILE"
echo "Done."
echo "Redeploy if needed: railway up"
