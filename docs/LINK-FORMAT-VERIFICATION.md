# Chat widget link format verification

Use this runbook to confirm which link format makes URLs clickable in the **Gorgias Shopify Chat Widget**.

## 1. Install and run formatter tests

```bash
npm install
npm run test:formatter
```

**Expected:** `chat-formatter tests passed.`

---

## 2. Discover which format the widget uses

### 2.1 Get a chat ticket ID

1. In **Gorgias**, open **Tickets** (or **Chat & Messaging**).
2. Open any **chat** conversation (channel = chat).
3. Copy the **ticket ID** from the URL or ticket details (e.g. `123456789`).

### 2.2 Run the link-format test

From the project root, with `.env.local` containing `GORGIAS_DOMAIN`, `GORGIAS_API_KEY`, `GORGIAS_EMAIL`:

**Windows (PowerShell):**
```powershell
$env:TICKET_ID = "YOUR_TICKET_ID_HERE"
npm run test:link-formats
```

**Linux / macOS (bash):**
```bash
TICKET_ID=YOUR_TICKET_ID_HERE npm run test:link-formats
```

Replace `YOUR_TICKET_ID_HERE` with the ticket ID from step 2.1.

**Expected:** Three messages are posted to that ticket (Test 1 Plain URL, Test 2 Markdown, Test 3 HTML).

### 2.3 Check on the Shopify storefront

1. Open your **Shopify storefront** (customer-facing site where the Gorgias chat widget is embedded).
2. Open the **same conversation** (same customer/ticket) in the chat widget.
3. Find the **three test messages** and see which one shows a **clickable** link:
   - **Test 1 (Plain URL)** → link is plain text or clickable?
   - **Test 2 (Markdown)** → link is plain text or clickable?
   - **Test 3 (HTML)** → link is plain text or clickable?

---

## 3. Set format and deploy

Set the env var that matches the test that was clickable:

| If this test was clickable | Set |
|----------------------------|-----|
| Test 3 (HTML)              | `CHAT_LINK_FORMAT=html` (default) or leave unset |
| Test 1 (Plain URL)         | `CHAT_LINK_FORMAT=plain` |
| Test 2 (Markdown)          | `CHAT_LINK_FORMAT=markdown` |

- **Railway:** Project → Variables → add or set `CHAT_LINK_FORMAT`.
- **Vercel:** Project → Settings → Environment Variables.
- **Local:** Add to `.env.local`.

Then **redeploy** so production uses the new value.

---

## 4. Pre-deploy smoke test (widget delivery + links)

When link formatting is enabled, the Gorgias API may accept the message but **widget delivery** can fail ("message not delivered" in the Shopify chat). This smoke test posts one message with a URL and **fails the script** if Gorgias reports delivery failure.

**Run before deploy:**

```powershell
$env:TICKET_ID = "YOUR_CHAT_TICKET_ID"
npm run test:widget-delivery
```

- **Exit 0:** Gorgias did not report delivery failure. Manually verify in the widget (checklist printed by the script).
- **Exit 1:** Gorgias returned `failed_datetime` or `last_sending_error` → message not delivered to widget. Try `CHAT_LINK_FORMAT=plain` or check Railway logs (correlation `requestId` in logs).

**Checklist (manual, after script passes):**

1. Open the Shopify storefront and the same conversation in the chat widget.
2. **Condition A:** The smoke test message is visible (no "message not delivered").
3. **Condition B:** The URL in the message is clickable or at least intact.
4. If both pass, link formatting is safe for production.

---

## Quick reference

- Formatter tests (no API): `npm run test:formatter`
- Link-format test (needs real ticket): `TICKET_ID=<id> npm run test:link-formats` (bash) or `$env:TICKET_ID="<id>"; npm run test:link-formats` (PowerShell)
- Widget delivery smoke test: `TICKET_ID=<id> npm run test:widget-delivery`
