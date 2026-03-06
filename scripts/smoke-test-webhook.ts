/**
 * Smoke test: POST a fake Gorgias payload to the webhook to verify
 * the app receives it and calls Abacus (and optionally posts to Gorgias).
 *
 * Run with: npx tsx scripts/smoke-test-webhook.ts
 * Ensure the dev server is running first: npm run dev
 *
 * Requires: .env.local with ABACUS_DEPLOYMENT_ID, ABACUS_DEPLOYMENT_TOKEN for real Abacus call.
 * With DRY_RUN=true the webhook returns success without calling Abacus.
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const URL = `${BASE_URL}/api/webhooks/gorgias`;

const payload = {
  event: "message_created",
  ticket: { id: 123, customer: { email: "customer@example.com" } },
  message: {
    id: 456,
    body_text: "Hello — smoke test",
    from_agent: false,
    sender: { email: "customer@example.com" },
  },
};

async function main() {
  console.log("Smoke test: POST", URL);
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  console.log("HTTP", res.status);
  console.log(JSON.stringify(body, null, 2));
  if (!res.ok) {
    process.exit(1);
  }
  const ok = body && typeof body === "object" && (body as { success?: boolean }).success === true;
  if (!ok) {
    process.exit(1);
  }
  console.log("\nPass: webhook accepted. Check dev server logs for ABACUS_CALL_START / ABACUS_RESPONSE.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
