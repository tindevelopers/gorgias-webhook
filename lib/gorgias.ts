export interface PostGorgiasMessageArgs {
  ticketId: string;
  body: string;
  /** Chat visitor/conversation ID from webhook event.context; used for source.to when set. */
  eventContext?: string | null;
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

export async function postGorgiasMessage(args: PostGorgiasMessageArgs): Promise<void> {
  const baseUrl = buildGorgiasBaseUrl();
  const auth = buildAuthHeader();
  const email = requiredEnv("GORGIAS_EMAIL");

  function escapeHtmlText(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Linkify URLs for body_html. Use conservative regex so chat delivery does not break (avoid [^\s]+).
  function linkifyToHtml(text: string): string {
    const urlRe = /https?:\/\/[^\s<>"']+/g;
    const trailingRe = /[)\],.;:!?]+$/;
    let out = "";
    let lastIdx = 0;
    for (const m of text.matchAll(urlRe)) {
      const raw = m[0];
      const idx = m.index ?? 0;
      if (idx > lastIdx) out += escapeHtmlText(text.slice(lastIdx, idx));
      let url = raw;
      let trailing = "";
      while (true) {
        const next = url.replace(trailingRe, "");
        if (next === url) break;
        trailing = url.slice(next.length) + trailing;
        url = next;
      }
      const safeHref = escapeHtmlText(url);
      const safeLabel = escapeHtmlText(url);
      out += `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeLabel}</a>`;
      if (trailing) out += escapeHtmlText(trailing);
      lastIdx = idx + raw.length;
    }
    if (lastIdx < text.length) out += escapeHtmlText(text.slice(lastIdx));
    return `<p>${out.replace(/\n/g, "<br>")}</p>`;
  }

  const controller = new AbortController();
  const timeoutMs = Number(process.env.GORGIAS_TIMEOUT_MS || 20000);
  const t = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 20000);

  try {
    const url = `${baseUrl}/tickets/${encodeURIComponent(args.ticketId)}/messages`;

    // Chat requires source { type, to, from } with visitor ID. event.context = current chat session (best for widget delivery).
    const fromEventContext = !!args.eventContext?.trim();
    const visitorId =
      args.eventContext?.trim() || (await getChatVisitorId(args.ticketId));
    if (!visitorId) {
      console.error("[GorgiasWebhook] FAIL step=no_chat_visitor_id", { ticketId: args.ticketId });
      throw new Error("Could not find chat visitor ID for ticket");
    }
    console.log("[GorgiasWebhook] chat visitor source", {
      ticketId: args.ticketId,
      fromEventContext,
      hint: fromEventContext ? "event.context from webhook" : "ticket fetch fallback",
    });

    const payload: Record<string, unknown> = {
      body: args.body,
      body_text: args.body,
      // For chat widget: use HTML with linkified URLs when supported.
      body_html: linkifyToHtml(args.body),
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

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: auth,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const resText = await res.text();
    if (!res.ok) {
      console.error("[GorgiasWebhook] FAIL step=gorgias_post_http", {
        status: res.status,
        body: resText?.slice(0, 4000),
      });
      throw new Error(`Gorgias HTTP ${res.status}`);
    }
    // Log delivery status when present (Gorgias sends async; failed_datetime = delivery failed)
    try {
      const created = resText ? (JSON.parse(resText) as Record<string, unknown>) : null;
      const failedAt = created?.failed_datetime;
      if (failedAt) {
        console.warn("[GorgiasWebhook] message created but delivery failed", {
          ticketId: args.ticketId,
          failed_datetime: failedAt,
        });
      }
    } catch {
      /* ignore */
    }
  } finally {
    clearTimeout(t);
  }
}

