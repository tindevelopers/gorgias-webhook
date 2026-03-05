export interface PostGorgiasMessageArgs {
  ticketId: string;
  body: string;
  /** Chat visitor/conversation ID from webhook event.context; used for source.to when set. */
  eventContext?: string | null;
  /** Gorgias customer ID (ticket.customer.id); used as receiver for chat so the widget shows the reply. */
  customerId?: string | number | null;
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
    console.log("[GorgiasWebhook] chat visitor source", {
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

    // Per Gorgias troubleshooting guide: working payload includes body_html as simple <p> (no links).
    const safeHtml = (s: string) =>
      s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/\n/g, "<br>");
    const payload: Record<string, unknown> = {
      body: args.body,
      body_text: args.body,
      body_html: `<p>${safeHtml(args.body)}</p>`,
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

    // #region agent log
    const visitorIdSuffix = visitorId ? visitorId.slice(-8) : "";
    fetch("http://127.0.0.1:7318/ingest/6e991345-16b8-41c6-b3bf-80cb1e473188", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6d486c" },
      body: JSON.stringify({
        sessionId: "6d486c",
        location: "gorgias.ts:pre_post",
        message: "payload before create message",
        data: {
          ticketId: args.ticketId,
          visitorIdSuffix,
          fromEventContext,
          noReceiver: true,
          hypothesisId: "H1,H2,H3",
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion

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
        status: res.status,
        body: resText?.slice(0, 4000),
      });
      throw new Error(`Gorgias HTTP ${res.status}`);
    }
    // Log full response for debugging chat delivery
    try {
      const created = resText ? (JSON.parse(resText) as Record<string, unknown>) : null;
      const failedAt = created?.failed_datetime;
      const lastError = created?.last_sending_error as { error?: string } | undefined;
      const errMsg = lastError?.error;
      const msgId = created?.id;
      const sourceResp = created?.source as Record<string, unknown> | undefined;
      console.log("[GorgiasWebhook] GORGIAS_RESPONSE", {
        ticketId: args.ticketId,
        messageId: msgId ?? null,
        failed_datetime: failedAt ?? null,
        last_sending_error: errMsg ?? null,
        source_type: sourceResp?.type ?? null,
        source_to: JSON.stringify(sourceResp?.to ?? null),
      });
      if (failedAt || errMsg) {
        console.warn("[GorgiasWebhook] message created but delivery failed", {
          ticketId: args.ticketId,
          failed_datetime: failedAt ?? undefined,
          last_sending_error: errMsg ?? undefined,
        });
      }
    } catch {
      /* ignore */
    }
  } finally {
    clearTimeout(t);
  }
}

