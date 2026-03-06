/**
 * Smoke test: post a message with a product URL and verify Gorgias API reports
 * successful widget delivery (no failed_datetime / last_sending_error).
 *
 * Use before deploy to confirm link formatting does not break delivery.
 * Run manually after to verify the message in the Shopify Chat Widget (checklist below).
 *
 * Usage:
 *   TICKET_ID=<chat-ticket-id> npx tsx scripts/smoke-test-widget-delivery.ts
 *   Windows: $env:TICKET_ID = "45465291"; npx tsx scripts/smoke-test-widget-delivery.ts
 *
 * Requires: .env.local with GORGIAS_DOMAIN, GORGIAS_EMAIL, GORGIAS_API_KEY.
 * Optional: CHAT_LINK_FORMAT (plain | html | markdown). Default: html.
 */

import { config } from "dotenv";
import { resolve } from "path";
import { postGorgiasMessage } from "../lib/gorgias";

config({ path: resolve(process.cwd(), ".env.local") });

const TICKET_ID = process.env.TICKET_ID;
const TEST_BODY = `Smoke test (widget delivery + link)\n\nBuy here: https://example.com/product/smoke-${Date.now()}`;

async function main() {
  if (!TICKET_ID?.trim()) {
    console.error("Missing TICKET_ID. Set it to a chat ticket id (e.g. $env:TICKET_ID = \"45465291\")");
    process.exit(1);
  }

  const requestId = `smoke-${Date.now().toString(36)}`;
  console.log("[SmokeTest] Posting message with link formatting...", { requestId, ticketId: TICKET_ID });

  const response = await postGorgiasMessage({
    ticketId: TICKET_ID.trim(),
    body: TEST_BODY,
    requestId,
  });

  if (!response) {
    console.error("[SmokeTest] FAIL: No response from Gorgias create-message API.");
    process.exit(1);
  }

  const failedAt = response.failed_datetime;
  const lastError = response.last_sending_error as { error?: string } | undefined;
  const errMsg = lastError?.error;

  if (failedAt || errMsg) {
    console.error("[SmokeTest] FAIL: Gorgias reports widget delivery failure.");
    console.error("  failed_datetime:", failedAt ?? "(none)");
    console.error("  last_sending_error:", errMsg ?? "(none)");
    console.error("  → Message was created but not delivered to the Shopify Chat Widget.");
    console.error("  → Try CHAT_LINK_FORMAT=plain or check Railway logs for this requestId:", requestId);
    process.exit(1);
  }

  console.log("[SmokeTest] API success; Gorgias did not report delivery failure (delivery_ok).");
  console.log("  messageId:", response.id ?? "(unknown)");
  console.log("");
  console.log("--- Widget verification checklist (manual) ---");
  console.log("1. Open the Shopify storefront where the Gorgias Chat Widget is embedded.");
  console.log("2. Open the same conversation (ticket id:", TICKET_ID, ") in the widget.");
  console.log("3. Condition A: The smoke test message is visible (no \"message not delivered\").");
  console.log("4. Condition B: The URL in the message is clickable (or at least intact).");
  console.log("5. If both pass, link formatting is safe for production.");
  console.log("-----------------------------------------------");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
