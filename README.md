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
- Otherwise: responds with `{ "success": true, "received_event": "ticket-message-created" }` (or the `event` value from the payload if present).
- Invalid JSON: `400` with `{ "success": false, "error": "Invalid JSON body" }`.
- Non-POST methods: `405` with `{ "success": false, "error": "Method not allowed" }`.

## Deploy to Vercel

```bash
npm run build
```

Then connect the repo to Vercel or use the Vercel CLI. The App Router and API route are compatible with Vercel serverless functions.
