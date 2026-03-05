export interface GetAbacusAnswerArgs {
  conversationId: string;
  message: string;
  customerEmail?: string;
  ticketId: string;
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing env var: ${name}`);
  return v.trim();
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function normalizePath(path: string): string {
  if (!path) return "/chat";
  return path.startsWith("/") ? path : `/${path}`;
}

function extractAnswerText(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;

  const obj = json as Record<string, unknown>;
  const directCandidates = ["answer", "message", "output"];
  for (const k of directCandidates) {
    if (typeof obj[k] === "string" && obj[k].trim()) return (obj[k] as string).trim();
  }

  const data = obj["data"];
  if (data && typeof data === "object") {
    const dataObj = data as Record<string, unknown>;
    for (const k of directCandidates) {
      if (typeof dataObj[k] === "string" && dataObj[k].trim()) return (dataObj[k] as string).trim();
    }
  }

  return null;
}

export async function getAbacusAnswer(args: GetAbacusAnswerArgs): Promise<string> {
  const apiKey = requiredEnv("ABACUS_API_KEY");
  const baseUrl = normalizeBaseUrl(requiredEnv("ABACUS_APP_BASE_URL"));
  const endpoint = normalizePath(process.env.ABACUS_CHAT_ENDPOINT?.trim() || "/chat");

  const chatbotId = process.env.ABACUS_CHATBOT_ID?.trim() || undefined;
  const deploymentId = process.env.ABACUS_DEPLOYMENT_ID?.trim() || undefined;

  const url = `${baseUrl}${endpoint}`;

  const controller = new AbortController();
  const timeoutMs = Number(process.env.ABACUS_TIMEOUT_MS || 20000);
  const t = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 20000);

  try {
    const payload = {
      conversation_id: args.conversationId,
      message: args.message,
      customer: args.customerEmail ? { email: args.customerEmail } : undefined,
      meta: { ticket_id: args.ticketId, channel: "gorgias_chat" },
      chatbot_id: chatbotId,
      deployment_id: deploymentId,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        "x-api-key": apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? (JSON.parse(text) as unknown) : null;
    } catch {
      json = null;
    }

    if (!res.ok) {
      console.error("[GorgiasWebhook] FAIL step=abacus_http", {
        status: res.status,
        body: text?.slice(0, 2000),
      });
      throw new Error(`Abacus HTTP ${res.status}`);
    }

    const answer = extractAnswerText(json);
    if (answer) return answer;

    console.warn("[GorgiasWebhook] FAIL step=abacus_shape_unknown", {
      url,
      keys: json && typeof json === "object" ? Object.keys(json as Record<string, unknown>) : typeof json,
      sample: text?.slice(0, 2000),
    });

    // Safe fallback: we got a 2xx but no recognizable text field.
    return "Sorry — I couldn't generate a reply right now.";
  } finally {
    clearTimeout(t);
  }
}

