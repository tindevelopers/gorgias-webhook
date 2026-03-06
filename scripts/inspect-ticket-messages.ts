/**
 * Inspect recent ticket messages to find where links break.
 *
 * It prints whether each message contains anchors in body_html and whether they were stripped
 * (via stripped_html), plus delivery flags (failed_datetime / last_sending_error).
 *
 * Usage (PowerShell):
 *   $env:TICKET_ID="45465291"
 *   npm run inspect:ticket
 *
 * Requires: .env.local with GORGIAS_DOMAIN, GORGIAS_EMAIL, GORGIAS_API_KEY
 */

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

const TICKET_ID = process.env.TICKET_ID?.trim();
const DOMAIN = process.env.GORGIAS_DOMAIN?.trim();
const EMAIL = process.env.GORGIAS_EMAIL?.trim();
const API_KEY = process.env.GORGIAS_API_KEY?.trim();

function baseUrlFromDomain(raw: string): string {
  const d = raw.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const sub = d.includes(".gorgias.com") ? d.split(".gorgias.com")[0] : d;
  return `https://${sub}.gorgias.com/api`;
}

function sample(s: unknown, n = 240): string {
  if (typeof s !== "string") return "";
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function countOccur(hay: string, needle: string): number {
  if (!needle) return 0;
  let c = 0;
  let i = 0;
  while (true) {
    const idx = hay.indexOf(needle, i);
    if (idx === -1) break;
    c += 1;
    i = idx + needle.length;
  }
  return c;
}

function around(s: string, marker: string, n = 140): string {
  const idx = s.indexOf(marker);
  if (idx === -1) return "";
  const start = Math.max(0, idx - n);
  const end = Math.min(s.length, idx + marker.length + n);
  return s.slice(start, end).replace(/\s+/g, " ").trim();
}

async function main() {
  if (!TICKET_ID || !DOMAIN || !EMAIL || !API_KEY) {
    console.error("Missing env: TICKET_ID, GORGIAS_DOMAIN, GORGIAS_EMAIL, GORGIAS_API_KEY");
    process.exit(1);
  }

  const baseUrl = baseUrlFromDomain(DOMAIN);
  const auth = Buffer.from(`${EMAIL}:${API_KEY}`, "utf8").toString("base64");

  const limit = Number(process.env.INSPECT_LIMIT || 12);
  const onlyInteresting = (process.env.INSPECT_ONLY_INTERESTING || "1") !== "0";
  // Use /api/messages with ticket_id filter; supports order_by=created_datetime:desc
  const url = `${baseUrl}/messages?ticket_id=${encodeURIComponent(TICKET_ID)}&order_by=${encodeURIComponent(
    "created_datetime:desc"
  )}&limit=${encodeURIComponent(String(Number.isFinite(limit) ? limit : 12))}`;
  const res = await fetch(url, {
    headers: { accept: "application/json", authorization: `Basic ${auth}` },
  });
  const text = await res.text();
  if (!res.ok) {
    console.error("Failed to fetch messages:", res.status, text.slice(0, 2000));
    process.exit(1);
  }

  const json = text ? (JSON.parse(text) as any) : null;
  const messages: any[] = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  if (!messages.length) {
    console.error("No messages returned. Response keys:", Object.keys(json ?? {}));
    process.exit(1);
  }

  // Sort newest-first (ids are numeric)
  messages.sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0));

  console.log(`Inspecting ${messages.length} messages for ticket ${TICKET_ID} (newest first)`);
  for (const m of messages) {
    const id = m?.id;
    const created = m?.created_datetime ?? m?.created_at ?? null;
    const fromAgent = m?.from_agent ?? null;
    const isPublic = m?.public ?? null;
    const failedAt = m?.failed_datetime ?? null;
    const lastErr = m?.last_sending_error?.error ?? null;
    const bodyHtml = typeof m?.body_html === "string" ? m.body_html : "";
    const strippedHtml = typeof m?.stripped_html === "string" ? m.stripped_html : "";
    const bodyText = typeof m?.body_text === "string" ? m.body_text : "";
    const hasAnchorBody = bodyHtml.includes("<a ");
    const hasAnchorStripped = strippedHtml.includes("<a ");
    const hasUrlText = bodyText.includes("https://");
    const httpsCountText = countOccur(bodyText, "https");
    const httpsCountHtml = countOccur(bodyHtml, "https");
    const anchorCountHtml = countOccur(bodyHtml, "<a ");

    const isInteresting =
      !!failedAt ||
      !!lastErr ||
      hasAnchorBody ||
      hasAnchorStripped ||
      hasUrlText;
    if (onlyInteresting && !isInteresting) continue;

    console.log("----");
    console.log({
      id,
      created,
      from_agent: fromAgent,
      public: isPublic,
      failed_datetime: failedAt,
      last_sending_error: lastErr,
      body_html_has_anchor: hasAnchorBody,
      body_html_anchor_count: anchorCountHtml,
      stripped_html_has_anchor: hasAnchorStripped,
      body_text_has_https: hasUrlText,
      body_text_https_count: httpsCountText,
      body_html_https_count: httpsCountHtml,
    });
    if (hasUrlText || hasAnchorBody) {
      console.log("body_text_sample:", sample(bodyText));
      console.log("body_html_sample:", sample(bodyHtml));
      console.log("stripped_html_sample:", sample(strippedHtml));
      const urlCtxText = around(bodyText, "https");
      const urlCtxHtml = around(bodyHtml, "https");
      const anchorCtxHtml = around(bodyHtml, "<a ");
      if (urlCtxText) console.log("body_text_ctx:", urlCtxText);
      if (urlCtxHtml) console.log("body_html_ctx:", urlCtxHtml);
      if (anchorCtxHtml) console.log("body_html_anchor_ctx:", anchorCtxHtml);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

