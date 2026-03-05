# Gorgias Webhook

Minimal Next.js 14 (App Router) + TypeScript project that exposes a webhook endpoint for Gorgias.

**Repository:** [tindevelopers/gorgias-webhook](https://github.com/tindevelopers/gorgias-webhook)

## Setup

```bash
npm install
```

## Run locally

```bash
npm run dev
```

Server runs at [http://localhost:3000](http://localhost:3000).

## Webhook endpoint

- **URL:** `POST /api/webhooks/gorgias`
- **Body:** JSON (Gorgias event payload)

### Behavior

- If `message.from_agent === true`: responds with `{ "success": true, "ignored": "agent_message" }`.
- Otherwise: calls Abacus to generate a reply, then posts it back into the same Gorgias ticket conversation.
- Invalid JSON: `400` with `{ "success": false, "error": "Invalid JSON body" }`.
- Non-POST methods: `405` with `{ "success": false, "error": "Method not allowed" }`.

## Environment variables

Create `.env.local` (do not commit) and set:

```bash
# Gorgias
GORGIAS_DOMAIN=pawpointers
GORGIAS_API_KEY=...
GORGIAS_EMAIL=developer@tin.info

# Abacus
ABACUS_API_KEY=...
ABACUS_APP_BASE_URL=https://gorgiastest.abacusai.app
ABACUS_CHAT_ENDPOINT=/chat
ABACUS_CHATBOT_ID=...
ABACUS_DEPLOYMENT_ID=...
ABACUS_CONV_KEY_STRATEGY=ticket
```

## Configure Gorgias HTTP Integration (MVP)

In Gorgias:

- **Settings → Integrations → HTTP Integrations → Add integration**
- **Trigger/Event**: Ticket message created (or equivalent message-created event)
- **Method**: POST
- **URL**: `https://<your-vercel-domain>/api/webhooks/gorgias`
- **Content-Type**: `application/json`
- **Headers**: none required for MVP

After saving, send a test message in Live Chat:

- Verify in **HTTP Integrations → Events** that the webhook shows **200**.
- Verify in the ticket conversation that an automated reply is posted back.

## Deploy to Vercel

```bash
npm run build
```

Then connect the repo to Vercel or use the Vercel CLI. The App Router and API route are compatible with Vercel serverless functions.
