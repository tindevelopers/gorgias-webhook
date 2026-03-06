/**
 * Sends three test messages to a Gorgias ticket, each with a different link format:
 * 1. Plain URL
 * 2. Markdown [text](url)
 * 3. HTML <a href="...">
 *
 * Use this to verify which format renders as clickable in the Gorgias Shopify Chat Widget.
 *
 * Usage:
 *   TICKET_ID=123456 npx tsx scripts/send-link-format-tests.ts
 *   Or from project root with .env.local: npx tsx scripts/send-link-format-tests.ts
 *
 * Requires: GORGIAS_DOMAIN, GORGIAS_API_KEY, GORGIAS_EMAIL, TICKET_ID
 */

import { config } from "dotenv";
import { resolve } from "path";
import { formatBodyForChat } from "../lib/chat-formatter";

config({ path: resolve(process.cwd(), ".env.local") });

const TICKET_ID = process.env.TICKET_ID;
const GORGIAS_DOMAIN = process.env.GORGIAS_DOMAIN;
const GORGIAS_EMAIL = process.env.GORGIAS_EMAIL;
const GORGIAS_API_KEY = process.env.GORGIAS_API_KEY;

const TEST_URL = "https://example.com/product/123";

async function main() {
  const missing: string[] = [];
  if (!TICKET_ID) missing.push("TICKET_ID (set in shell or add to .env.local)");
  if (!GORGIAS_DOMAIN) missing.push("GORGIAS_DOMAIN");
  if (!GORGIAS_EMAIL) missing.push("GORGIAS_EMAIL");
  if (!GORGIAS_API_KEY) missing.push("GORGIAS_API_KEY");
  if (missing.length) {
    console.error("Missing env:", missing.join(", "));
    console.error("Create .env.local in project root with GORGIAS_DOMAIN, GORGIAS_EMAIL, GORGIAS_API_KEY. Set TICKET_ID in shell: $env:TICKET_ID = \"345028702\"");
    process.exit(1);
  }

  const domain = GORGIAS_DOMAIN as string;
  const email = GORGIAS_EMAIL as string;
  const apiKey = GORGIAS_API_KEY as string;
  const ticketId = TICKET_ID as string;
  const baseUrl = `https://${domain.replace(/^https?:\/\//, "").replace(/\.gorgias\.com.*/, "")}.gorgias.com/api`;
  const auth = Buffer.from(`${email}:${apiKey}`, "utf8").toString("base64");

  // 1. Get visitor ID from ticket
  const ticketRes = await fetch(`${baseUrl}/tickets/${ticketId}`, {
    headers: { accept: "application/json", authorization: `Basic ${auth}` },
  });
  if (!ticketRes.ok) {
    console.error("Failed to fetch ticket:", ticketRes.status, await ticketRes.text());
    process.exit(1);
  }
  const ticket = (await ticketRes.json()) as Record<string, unknown>;
  const meta = ticket?.meta as Record<string, unknown> | undefined;
  const chat = meta?.chat as Record<string, unknown> | undefined;
  let visitorId: string | null = null;
  if (typeof chat?.conversation_id === "string") visitorId = chat.conversation_id;
  if (!visitorId && ticket?.customer) {
    const channels = (ticket.customer as Record<string, unknown>)?.channels as Array<{ type?: string; address?: string }> | undefined;
    const ch = Array.isArray(channels) ? channels.find((c) => c?.type === "chat") : undefined;
    if (typeof ch?.address === "string") visitorId = ch.address;
  }
  if (!visitorId) {
    console.error("Could not find chat visitor ID on ticket. Is this a chat ticket?");
    process.exit(1);
  }

  const postMessage = async (body_text: string, body_html: string, label: string) => {
    const res = await fetch(`${baseUrl}/tickets/${ticketId}/messages`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        body: body_text,
        body_text,
        body_html,
        channel: "chat",
        via: "api",
        from_agent: true,
        sender: { email },
        source: { type: "chat", to: [{ address: visitorId }], from: { address: "" } },
      }),
    });
    if (!res.ok) {
      console.error(`${label}: POST failed`, res.status, await res.text());
      return;
    }
    console.log(`${label}: message posted. Check the Shopify Chat Widget.`);
  };

  // Use same formatter as app so we test real payloads
  const test1 = formatBodyForChat(
    `Test 1 — Plain URL\n\nBuy here:\n${TEST_URL}`,
    "plain"
  );
  await postMessage(test1.body_text, test1.body_html, "Test 1 (Plain URL)");

  const test2 = formatBodyForChat(
    `Test 2 — Markdown\n\nBuy here:\n[Product Link](${TEST_URL})`,
    "markdown"
  );
  await postMessage(test2.body_text, test2.body_html, "Test 2 (Markdown)");

  const test3 = formatBodyForChat(
    `Test 3 — HTML\n\nBuy here:\n${TEST_URL}`,
    "html"
  );
  await postMessage(test3.body_text, test3.body_html, "Test 3 (HTML <a> link)");

  console.log("\nDone. Open the conversation in the Gorgias Shopify Chat Widget and see which message shows a clickable link.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
