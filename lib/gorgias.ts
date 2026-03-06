import type { ChatLinkFormat } from "./chat-formatter";
import { formatBodyForChat } from "./chat-formatter";

export interface PostGorgiasMessageArgs {
  ticketId: string;
  body: string;
  /** Chat visitor/conversation ID from webhook event.context; used for source.to when set. */
  eventContext?: string | null;
  /** Gorgias customer ID (ticket.customer.id); used as receiver for chat so the widget shows the reply. */
  customerId?: string | number | null;
  /** Correlation ID for logging (webhook receipt → Abacus → Gorgias post). */
  requestId?: string | null;
}

/** Response from Gorgias create-message API; used to detect widget delivery failure. */
export interface GorgiasMessageResponse {
  id?: unknown;
  failed_datetime?: string | null;
  last_sending_error?: { error?: string } | null;
  source?: Record<string, unknown>;
  [key: string]: unknown;
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing env var: ${name}`);
  return v.trim();
}

export function buildAuthHeader(): string {
  const email = requiredEnv("GORGIAS_EMAIL");
  const apiKey = requiredEnv("GORGIAS_API_KEY");
  const token = Buffer.from(`${email}:${apiKey}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

function normalizeGorgiasDomain(domain: string): string {
  const d = domain.trim();
  if (d.includes("gorgias.com")) {
    const withoutProtocol = d.replace(/^https?:\/\//, "");
    return withoutProtocol.split(".gorgias.com")[0] ?? d;
  }
  return d;
}

export function buildGorgiasBaseUrl(): string {
  const domain = normalizeGorgiasDomain(requiredEnv("GORGIAS_DOMAIN"));
  return `https://${domain}.gorgias.com/api`;
}

/** Fetch ticket and extract chat visitor ID from meta or customer channels.
 * Required for chat widget delivery - Gorgias needs source.to with this ID. */
export async function getChatVisitorId(ticketId: string): Promise<string | null> {
  const baseUrl = buildGorgiasBaseUrl();
  const auth = buildAuthHeader();
  const url = `${baseUrl}/tickets/${encodeURIComponent(ticketId)}`;
  const controller = new AbortController();
  const timeoutMs = Number(process.env.GORGIAS_TIMEOUT_MS || 20000);
  const t = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 20000);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json", authorization: auth },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const ticket = (await res.json()) as Record<string, unknown>;
    const meta = ticket?.meta as Record<string, unknown> | undefined;
    const chat = meta?.chat as Record<string, unknown> | undefined;
    if (chat?.conversation_id && typeof chat.conversation_id === "string") {
      return chat.conversation_id;
    }
    const customer = ticket?.customer as Record<string, unknown> | undefined;
    const channels = customer?.channels as Array<{ type?: string; address?: string }> | undefined;
    if (Array.isArray(channels)) {
      const chatCh = channels.find((ch) => ch?.type === "chat");
      if (chatCh?.address && typeof chatCh.address === "string") {
        return chatCh.address;
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function postGorgiasMessage(args: PostGorgiasMessageArgs): Promise<GorgiasMessageResponse | undefined> {
  const baseUrl = buildGorgiasBaseUrl();
  const auth = buildAuthHeader();
  const email = requiredEnv("GORGIAS_EMAIL");

  const controller = new AbortController();
  const timeoutMs = Number(process.env.GORGIAS_TIMEOUT_MS || 20000);
  const t = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 20000);

  try {
    const url = `${baseUrl}/tickets/${encodeURIComponent(args.ticketId)}/messages`;

    // Per Gorgias troubleshooting guide: ALWAYS fetch visitor ID from ticket.meta.chat.conversation_id
    // or customer.channels[type=chat].address. Do NOT use event.context — it is not the visitor/session ID.
    const ticketVisitorId = await getChatVisitorId(args.ticketId);
    const eventCtx = args.eventContext?.trim() || null;

    const visitorId = ticketVisitorId;
    const requestId = args.requestId ?? null;
    console.log("[GorgiasWebhook] chat visitor source", {
      requestId,
      ticketId: args.ticketId,
      ticketVisitorId: ticketVisitorId ? `...${ticketVisitorId.slice(-8)}` : null,
      eventContext: eventCtx ? `...${eventCtx.slice(-8)}` : null,
      match: ticketVisitorId === eventCtx,
      using: "ticket fetch (per troubleshooting guide)",
    });

    if (!visitorId) {
      console.error("[GorgiasWebhook] FAIL step=no_chat_visitor_id", { ticketId: args.ticketId });
      throw new Error("Could not find chat visitor ID for ticket");
    }

    const linkFormat = (process.env.CHAT_LINK_FORMAT || "html").trim().toLowerCase() as ChatLinkFormat;
    if (linkFormat !== "plain" && linkFormat !== "html" && linkFormat !== "markdown") {
      throw new Error(`Invalid CHAT_LINK_FORMAT: ${process.env.CHAT_LINK_FORMAT}. Use plain, html, or markdown.`);
    }
    const maxChars = Number(process.env.GORGIAS_CHAT_MAX_CHARS || 2200);
    const maxUrls = Number(process.env.GORGIAS_CHAT_MAX_URLS || 12);

    const splitIntoChunks = (text: string, maxLen: number): string[] => {
      const t = text.trim();
      if (t.length <= maxLen) return [t];
      const blocks = t.split(/\n{2,}/g);
      const out: string[] = [];
      let cur = "";
      const pushCur = () => {
        const c = cur.trim();
        if (c) out.push(c);
        cur = "";
      };
      for (const b of blocks) {
        const next = cur ? `${cur}\n\n${b}` : b;
        if (next.length <= maxLen) {
          cur = next;
          continue;
        }
        if (cur) pushCur();
        if (b.length <= maxLen) {
          cur = b;
          continue;
        }
        // Fallback: split very long block by lines, then by spaces.
        const lines = b.split("\n");
        let lineCur = "";
        const pushLineCur = () => {
          const c = lineCur.trim();
          if (c) out.push(c);
          lineCur = "";
        };
        for (const line of lines) {
          const candidate = lineCur ? `${lineCur}\n${line}` : line;
          if (candidate.length <= maxLen) {
            lineCur = candidate;
            continue;
          }
          if (lineCur) pushLineCur();
          if (line.length <= maxLen) {
            lineCur = line;
            continue;
          }
          // Split by words
          const words = line.split(/\s+/);
          let wCur = "";
          for (const w of words) {
            const wNext = wCur ? `${wCur} ${w}` : w;
            if (wNext.length <= maxLen) {
              wCur = wNext;
            } else {
              if (wCur) out.push(wCur);
              wCur = w;
            }
          }
          if (wCur) out.push(wCur);
        }
        if (lineCur) pushLineCur();
      }
      if (cur) pushCur();
      return out.length ? out : [t.slice(0, maxLen)];
    };

    const urlCount = (args.body.match(/https:\/\//g) || []).length;
    const needsChunking = args.body.length > maxChars || urlCount > maxUrls;
    const chunks = needsChunking ? splitIntoChunks(args.body, maxChars) : [args.body.trim()];
    if (needsChunking) {
      console.warn("[GorgiasWebhook] payload chunking enabled", {
        requestId,
        ticketId: args.ticketId,
        chunks: chunks.length,
        bodyLength: args.body.length,
        urlCount,
        maxChars,
        maxUrls,
      });
    }

    let lastCreated: GorgiasMessageResponse | undefined;

    for (let idx = 0; idx < chunks.length; idx++) {
      const chunk = chunks[idx] ?? "";
      const { body_text, body_html } = formatBodyForChat(chunk, linkFormat);

      const payload: Record<string, unknown> = {
        body: body_text,
        body_text,
        body_html,
        channel: "chat",
        via: "api",
        from_agent: true,
        sender: { email },
        source: {
          type: "chat",
          to: [{ address: visitorId }],
          from: { address: "" },
        },
      };
      // Do NOT send receiver for chat — doc: "receiver: Used for email/SMS, NOT for chat". Sending receiver can cause "Last message not delivered".

      const hasAnchorTag = body_html.includes("<a ");
      console.log("[GorgiasWebhook] GORGIAS_PAYLOAD", {
        requestId,
        ticketId: args.ticketId,
        linkFormat,
        chunk_index: idx + 1,
        chunk_total: chunks.length,
        body_text_length: body_text.length,
        body_html_length: body_html.length,
        body_html_has_anchor: hasAnchorTag,
        body_text_sample: body_text.slice(0, 200),
        body_html_sample: body_html.slice(0, 200),
      });

      const res = await fetch(url, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: auth,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const resText = await res.text();
      if (!res.ok) {
        console.error("[GorgiasWebhook] FAIL step=gorgias_post_http", {
          requestId,
          ticketId: args.ticketId,
          status: res.status,
          body: resText?.slice(0, 4000),
        });
        throw new Error(`Gorgias HTTP ${res.status}`);
      }

      let created: GorgiasMessageResponse | null = null;
      try {
        created = resText ? (JSON.parse(resText) as GorgiasMessageResponse) : null;
        const failedAt = created?.failed_datetime;
        const lastError = created?.last_sending_error as { error?: string } | undefined;
        const errMsg = lastError?.error;
        const msgId = created?.id;
        const sourceResp = created?.source as Record<string, unknown> | undefined;
        console.log("[GorgiasWebhook] GORGIAS_API_RESPONSE", {
          requestId,
          ticketId: args.ticketId,
          messageId: msgId ?? null,
          failed_datetime: failedAt ?? null,
          last_sending_error: errMsg ?? null,
          source_type: sourceResp?.type ?? null,
          source_to: JSON.stringify(sourceResp?.to ?? null),
          responseKeys: created ? Object.keys(created) : [],
          delivery_ok: !failedAt && !errMsg,
        });
        if (failedAt || errMsg) {
          console.warn("[GorgiasWebhook] CHAT_WIDGET_DELIVERY: message created but delivery failed", {
            requestId,
            ticketId: args.ticketId,
            failed_datetime: failedAt ?? undefined,
            last_sending_error: errMsg ?? undefined,
          });
          lastCreated = created ?? undefined;
          // Stop early; remaining chunks would likely also fail delivery
          break;
        }
      } catch {
        /* ignore */
      }

      lastCreated = created ?? undefined;
    }

    return lastCreated;
  } finally {
    clearTimeout(t);
  }
}

