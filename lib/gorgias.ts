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

export function buildGorgiasBaseUrl(): string {
  const domain = requiredEnv("GORGIAS_DOMAIN");
  return `https://${domain}.gorgias.com/api`;
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

    // Gorgias API fields can vary by channel/account; keep payload minimal and text-first.
    const payload: Record<string, unknown> = {
      body: args.body,
      channel: "chat",
      sender: { type: "agent", email },
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

    if (!res.ok) {
      const text = await res.text();
      console.error("[GorgiasWebhook] FAIL step=gorgias_post_http", {
        status: res.status,
        body: text?.slice(0, 4000),
      });
      throw new Error(`Gorgias HTTP ${res.status}`);
    }
  } finally {
    clearTimeout(t);
  }
}

