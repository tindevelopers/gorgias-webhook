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

export async function postGorgiasMessage(args: PostGorgiasMessageArgs): Promise<void> {
  const baseUrl = buildGorgiasBaseUrl();
  const auth = buildAuthHeader();
  const email = requiredEnv("GORGIAS_EMAIL");

  const controller = new AbortController();
  const timeoutMs = Number(process.env.GORGIAS_TIMEOUT_MS || 20000);
  const t = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 20000);

  try {
    const url = `${baseUrl}/tickets/${encodeURIComponent(args.ticketId)}/messages`;

    // Gorgias API: channel, via, sender, body_text (and optionally body_html) are required.
    const payload: Record<string, unknown> = {
      body: args.body,
      body_text: args.body,
      body_html: args.body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>"),
      channel: "chat",
      via: "api",
      from_agent: true,
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

