export interface PostGorgiasMessageArgs {
  ticketId: string;
  body: string;
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
      if (chatCh?.address && typeof chatCh.address === "string") return chatCh.address;
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

    // Chat requires source { type, to, from } with visitor ID - NOT receiver. See GORGIAS_CHAT_TROUBLESHOOTING_GUIDE.
    const visitorId = await getChatVisitorId(args.ticketId);
    if (!visitorId) {
      console.error("[GorgiasWebhook] FAIL step=no_chat_visitor_id", { ticketId: args.ticketId });
      throw new Error("Could not find chat visitor ID for ticket");
    }

    const payload: Record<string, unknown> = {
      body: args.body,
      body_text: args.body,
      body_html: args.body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>"),
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

    // #region agent log
    fetch('http://127.0.0.1:7318/ingest/6e991345-16b8-41c6-b3bf-80cb1e473188',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6d486c'},body:JSON.stringify({sessionId:'6d486c',location:'gorgias.ts:95',message:'Gorgias payload',data:{hasSource:!!payload.source,visitorId},hypothesisId:'source',timestamp:Date.now()})}).catch(()=>{});
    // #endregion

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
    // #region agent log
    try {
      const resJson = resText ? JSON.parse(resText) : null;
      fetch('http://127.0.0.1:7318/ingest/6e991345-16b8-41c6-b3bf-80cb1e473188',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6d486c'},body:JSON.stringify({sessionId:'6d486c',location:'gorgias.ts:75',message:'Gorgias 200 response',data:{dataKeys:resJson&&typeof resJson==='object'?Object.keys(resJson):[]},hypothesisId:'H1',timestamp:Date.now()})}).catch(()=>{});
    } catch (_) {}
    // #endregion
  } finally {
    clearTimeout(t);
  }
}

