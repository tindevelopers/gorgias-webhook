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

### Chat widget delivery (“Last message not delivered”)

For replies to **show in the customer chat widget** (not only in the Gorgias ticket), the webhook must receive the **chat session ID** in the payload. In Gorgias:

1. Go to **Apps → HTTP integration** (the one that calls this webhook).
2. In **Request body**, ensure the JSON includes **`event.context`** so we can route the reply to the correct chat session.

Example minimal body (Gorgias will substitute the `{{ ... }}` variables):

```json
{
  "event": {
    "context": "{{event.context}}",
    "type": "{{event.type}}",
    "user_id": "{{event.user_id}}"
  },
  "ticket": {
    "id": "{{ticket.id}}",
    "channel": "{{ticket.channel}}",
    "customer": { "id": "{{ticket.customer.id}}", "name": "{{ticket.customer.name}}", "email": "{{ticket.customer.email}}" }
  },
  "message": {
    "id": "{{message.id}}",
    "channel": "{{message.channel}}",
    "body_text": "{{message.body_text}}",
    "from_agent": "{{message.from_agent}}"
  }
}
```

If **`event.context`** is missing, the app falls back to fetching the ticket for a visitor ID; that can produce “Last message not delivered” in the widget. Check Railway logs for `CHAT_WIDGET_DELIVERY: event.context missing` to confirm.

Message payload matches the Gorgias chat troubleshooting guide: `body_text` + `body_html` (simple `<p>...</p>`, no links), `source` with visitor ID, no `receiver`. **If the reply appears in Gorgias but not in the widget**, first verify `event.context` is in your HTTP integration Request body, then check logs for `message created but delivery failed` and `last_sending_error`.

## Local smoke test (no Gorgias/Abacus)

1. **Start the app**

   ```bash
   npm install
   npm run dev
   ```

2. **Env for dry run** (optional). Create `.env.local` with `DRY_RUN=true` so the route does not call Abacus or Gorgias. You can use placeholder values for other vars; they are only used when `DRY_RUN` is not set.

3. **Hit the webhook with a fake payload**

   In a second terminal:

   ```bash
   curl -i -X POST "http://localhost:3000/api/webhooks/gorgias" \
     -H "Content-Type: application/json" \
     -d '{
       "event": "message_created",
       "ticket": { "id": 123, "customer": { "email": "customer@example.com" } },
       "message": {
         "id": 456,
         "body_text": "Hello — smoke test",
         "from_agent": false,
         "sender": { "email": "customer@example.com" }
       }
     }'
   ```

   Or run the script: `./scripts/smoke-test.sh`

4. **Expected**

   - **HTTP 200** with `{ "success": true, "ticket_id": "123", "dry_run": true }` when `DRY_RUN=true`.
   - Or `{ "success": true, "ticket_id": "123", ... }` when using real Abacus + Gorgias.
   - Or `{ "success": true, "ignored": "missing_fields" }` if the payload is missing required fields.

5. **Logs**

   You should see in the dev server:

   - `[GorgiasWebhook] INBOUND`
   - `[GorgiasWebhook] ABACUS_CALL_START` (or `... dry run`)
   - `[GorgiasWebhook] GORGIAS_POST_START` (or `... dry run`)

   With `DRY_RUN=true`, Abacus and Gorgias are not called.

---

## Testing ladder

Run these in order to isolate failures.

### 2) Unit test: Abacus only (no Gorgias)

Confirms Abacus credentials and request format. Uses the **getChatResponse** API directly (different from the app’s `lib/abacus` if you use a custom backend).

Set in `.env.local` (or export):

- `ABACUS_DEPLOYMENT_TOKEN`
- `ABACUS_DEPLOYMENT_ID`

Then:

```bash
./scripts/test-abacus-only.sh
# Or with a custom marker:
./scripts/test-abacus-only.sh PSD_OK_123
```

**Pass:** Abacus response contains the marker (e.g. `PSD_OK_123`) or clearly acknowledges it.  
**If it fails:** Fix Abacus config (token, deployment id, URL) first.

### 3) Unit test: Gorgias posting only (no Abacus)

Confirms Gorgias API credentials. Pick a test ticket in Gorgias and use its id.

```bash
TICKET_ID=123456789 ./scripts/test-gorgias-only.sh
```

**Pass:** The message "Gorgias API test: GORGIAS_OK_123" appears in that ticket.  
**If it fails:** Fix Gorgias domain, email, API key, and/or `postGorgiasMessage()`.

### 4) Full local e2e: webhook → Abacus → Gorgias

Set `DRY_RUN=false` (or remove it) and use real credentials. Use a **real ticket id** so the post-back succeeds.

```bash
# In one terminal
npm run dev

# In another
REAL_TICKET_ID=123456789 ./scripts/test-webhook-e2e.sh
```

**Pass:**

- Webhook returns **200** with `{ "success": true }`.
- Logs show: `INBOUND` → `ABACUS_CALL_OK` → `GORGIAS_POST_OK`.
- The ticket in Gorgias gets a new message containing `FULL_OK_123` (or equivalent).

### 5) Real Gorgias → local webhook (ngrok) e2e

Verifies the real-world path when Gorgias sends the webhook.

1. Run `npm run dev`.
2. In another terminal: `ngrok http 3000`.
3. In Gorgias: set webhook URL to `https://<ngrok-host>/api/webhooks/gorgias`.
4. Send a message in the Gorgias chat widget.

**Pass:** ngrok shows the POST; local logs show the pipeline; reply appears in the chat/ticket.

### 6) Common “it runs but nothing posts” issues

| Issue | Fix |
|-------|-----|
| Using localhost URL in Gorgias | Gorgias can’t reach localhost → use ngrok (or another tunnel). |
| Wrong path | Use **`/api/webhooks/gorgias`** (not `/api/gorgias/webhook`). |
| Webhook “ignores” | Check: `from_agent` is false and sender email ≠ `GORGIAS_EMAIL` (we ignore our own agent messages). |
| Payload shape | Gorgias event payload may differ; ensure your route reads `ticket.id`, `message.body_text` (or `body`/`text`), `message.from_agent`, `message.sender.email`. |
| Dedupe | Same `message.id` twice within TTL → ignored as duplicate. Use a new message id or wait. |
| Reply in Gorgias but not in chat widget ("Last message not delivered") | Add `"context": "{{event.context}}"` to the `event` object in the Gorgias HTTP integration **Request body**. See [Chat widget delivery](#chat-widget-delivery-last-message-not-delivered) above. |

To get an exact “final test” payload, paste (1) your route path (confirmed: **`/api/webhooks/gorgias`**) and (2) a sample real Gorgias webhook payload from **HTTP Integrations → Send test / View delivery**.

---

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

# Local smoke test without calling real APIs (no keys needed for curl test)
DRY_RUN=true
```

See `.env.example` for a full list. With `DRY_RUN=true`, Abacus and Gorgias are not called.

## Configure Gorgias HTTP Integration (MVP)

In Gorgias:

- **Settings → Integrations → HTTP Integrations → Add integration**
- **Trigger/Event**: Ticket message created (or equivalent message-created event)
- **Method**: POST
- **URL**: `https://<your-domain>/api/webhooks/gorgias`
- **Request body (JSON)**: **Required.** If left empty, Gorgias sends `Content-Length: 0` and the webhook returns 400. Add a JSON template with Gorgias variables, for example:

  ```json
  {
    "event": "message_created",
    "ticket_id": "{{ticket.id}}",
    "ticket": { "id": "{{ticket.id}}", "customer": { "email": "{{ticket.customer.email}}" } },
    "message": {
      "id": "{{message.id}}",
      "body_text": "{{message.body_text}}",
      "from_agent": "{{message.from_agent}}",
      "sender": { "email": "{{message.sender.email}}" }
    }
  }
  ```

  Use the exact variable syntax from Gorgias (e.g. `{{ticket.id}}` or `((ticket.id))` — check "See full list of variables" in the integration form).

After saving, send a test message in Live Chat:

- Verify in **HTTP Integrations → Events** that the webhook shows **200**.
- Verify in the ticket conversation that an automated reply is posted back.

## Deploy to Vercel

```bash
npm run build
```

Then connect the repo to Vercel or use the Vercel CLI. The App Router and API route are compatible with Vercel serverless functions.

## Deploy to Railway and push env vars

1. Install the Railway CLI: `npm install -g @railway/cli`
2. Log in (opens browser): `railway login`
3. From the project root, link the repo to your Railway project and service:
   ```bash
   railway link
   ```
   Choose the **gorgias-webhook** project and service (and environment, e.g. production). Or link by id:
   `railway link -p PROJECT_ID -s gorgias-webhook -e production`
4. Push local env vars from `.env.local` to Railway:
   ```bash
   ./scripts/railway-push-env.sh
   ```
   Override the service name if needed: `RAILWAY_SERVICE=your-service ./scripts/railway-push-env.sh`
5. Deploy: `railway up` (or rely on GitHub integration if connected).
