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

const ABACUS_API_BASE = "https://apps.abacus.ai";

function extractAnswerText(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;

  const obj = json as Record<string, unknown>;
  const directCandidates = ["answer", "message", "output", "text", "response"];
  for (const k of directCandidates) {
    if (typeof obj[k] === "string" && (obj[k] as string).trim())
      return (obj[k] as string).trim();
  }

  const data = obj["data"];
  if (data && typeof data === "object") {
    const dataObj = data as Record<string, unknown>;
    for (const k of directCandidates) {
      if (typeof dataObj[k] === "string" && (dataObj[k] as string).trim())
        return (dataObj[k] as string).trim();
    }
  }

  // Some APIs return { messages: [...] } or { result: { messages: [...] } } for the assistant reply
  let messages = obj["messages"];
  if (!messages && obj["result"] && typeof obj["result"] === "object") {
    messages = (obj["result"] as Record<string, unknown>)["messages"];
  }
  if (Array.isArray(messages) && messages.length > 0) {
    // Assistant reply is usually the last message with is_user: false
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m && typeof m === "object") {
        const msg = m as Record<string, unknown>;
        if (msg["text"] && typeof msg["text"] === "string") {
          const isUser = msg["is_user"] ?? msg["isUser"];
          if (!isUser) return (msg["text"] as string).trim();
        }
      }
    }
    const last = messages[messages.length - 1] as Record<string, unknown> | undefined;
    if (last?.text && typeof last.text === "string") return (last.text as string).trim();
  }

  return null;
}

/**
 * Calls Abacus getChatResponse: POST .../api/getChatResponse?deploymentToken=...&deploymentId=...
 * with messages in the body.
 */
export async function getAbacusAnswer(args: GetAbacusAnswerArgs): Promise<string> {
  const deploymentId = requiredEnv("ABACUS_DEPLOYMENT_ID");
  const deploymentToken = requiredEnv("ABACUS_DEPLOYMENT_TOKEN");
  const baseUrl = (process.env.ABACUS_API_BASE_URL || ABACUS_API_BASE).replace(/\/$/, "");
  const url = `${baseUrl}/api/getChatResponse?deploymentToken=${encodeURIComponent(deploymentToken)}&deploymentId=${encodeURIComponent(deploymentId)}`;

  const controller = new AbortController();
  const timeoutMs = Number(process.env.ABACUS_TIMEOUT_MS || 20000);
  const t = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 20000);

  try {
    const payload = {
      messages: [
        {
          text: args.message,
          is_user: true,
        },
      ],
      temperature: 0.0,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
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

    return "Sorry — I couldn't generate a reply right now.";
  } finally {
    clearTimeout(t);
  }
}
