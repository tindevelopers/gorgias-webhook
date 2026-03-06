import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { getAbacusAnswer } from "@/lib/abacus";
import { shouldProcessMessage } from "@/lib/dedupe";
import { postGorgiasMessage } from "@/lib/gorgias";

export const runtime = "nodejs";

type JsonObject = Record<string, unknown>;

function asObject(v: unknown): JsonObject | null {
  return v && typeof v === "object" ? (v as JsonObject) : null;
}

function asString(v: unknown): string | null {
  if (typeof v === "string") {
    const s = v.trim();
    return s ? s : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return String(v);
  }
  return null;
}

function booleanish(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes" || s === "y") return true;
    if (s === "false" || s === "0" || s === "no" || s === "n") return false;
  }
  return false;
}

function getNested(obj: JsonObject | null, ...keys: string[]): unknown {
  let cur: unknown = obj;
  for (const k of keys) {
    const o = asObject(cur);
    if (!o) return undefined;
    cur = o[k];
  }
  return cur;
}

/** Response when the message is from an agent and we ignore it */
interface IgnoredResponse {
  success: true;
  ignored: "agent_message" | "duplicate" | "missing_fields";
}

/** Response when we accept/process the event */
interface SuccessResponse {
  success: true;
  ticket_id?: string;
  message_id?: string;
  received_event?: string;
  dry_run?: boolean;
  queued?: boolean;
}

/** Error response shape */
interface ErrorResponse {
  success: false;
  error: string;
}

type WebhookResponse = IgnoredResponse | SuccessResponse | ErrorResponse;

export async function POST(request: NextRequest): Promise<NextResponse<WebhookResponse>> {
  try {
    const contentLength = request.headers.get("content-length");
    if (contentLength === "0" || contentLength === "" || contentLength === null) {
      return NextResponse.json<ErrorResponse>(
        {
          success: false,
          error:
            "Empty body. In Gorgias HTTP integration, add a Request body (JSON) with ticket/message variables. See docs.",
        },
        { status: 400 }
      );
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch (parseErr) {
      const pe = parseErr instanceof Error ? parseErr : new Error(String(parseErr));
      return NextResponse.json<ErrorResponse>(
        { success: false, error: pe.message === "Unexpected end of JSON input" ? "Empty body" : "Invalid JSON body" },
        { status: 400 }
      );
    }
    const payload = asObject(body);
    if (!payload) {
      return NextResponse.json<ErrorResponse>(
        { success: false, error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const ticketId =
      asString(getNested(payload, "ticket", "id")) ??
      asString(payload["ticket_id"]) ??
      asString(payload["ticketId"]);

    const messageId =
      asString(getNested(payload, "message", "id")) ??
      asString(getNested(payload, "message", "message_id")) ??
      asString(payload["message_id"]);

    const eventType =
      asString(getNested(payload, "event", "type")) ??
      asString(payload["event"]) ??
      asString(payload["type"]) ??
      undefined;

    const eventContext =
      asString(getNested(payload, "event", "context")) ??
      undefined;

    const fromAgentRaw = getNested(payload, "message", "from_agent");
    const fromAgent = booleanish(fromAgentRaw);

    const senderEmail =
      asString(getNested(payload, "message", "sender", "email")) ??
      asString(getNested(payload, "message", "sender", "address")) ??
      undefined;

    const ourAgentEmail = process.env.GORGIAS_EMAIL?.trim().toLowerCase();
    const fromOurSender =
      !!senderEmail && !!ourAgentEmail && senderEmail.toLowerCase() === ourAgentEmail;

    const requestId = crypto.randomBytes(4).toString("hex");
    console.log("[GorgiasWebhook] INBOUND", {
      requestId,
      ticket: ticketId ?? "unknown",
      msg: messageId ?? "unknown",
      from_agent: fromAgent,
      event: eventType ?? "unknown",
    });

    if (fromAgent) {
      // #region agent log
      fetch("http://127.0.0.1:7318/ingest/6e991345-16b8-41c6-b3bf-80cb1e473188", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6d486c" },
        body: JSON.stringify({
          sessionId: "6d486c",
          location: "route.ts:fromAgent",
          message: "ignored agent_message",
          data: { ticketId: ticketId ?? null, hypothesisId: "H4" },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      return NextResponse.json<IgnoredResponse>({
        success: true,
        ignored: "agent_message",
      });
    }

    if (fromOurSender) {
      return NextResponse.json<IgnoredResponse>({
        success: true,
        ignored: "agent_message",
      });
    }

    if (messageId && !shouldProcessMessage(messageId)) {
      return NextResponse.json<IgnoredResponse>({
        success: true,
        ignored: "duplicate",
      });
    }

    const messageText =
      asString(getNested(payload, "message", "body_text")) ??
      asString(getNested(payload, "message", "body")) ??
      asString(getNested(payload, "message", "text")) ??
      asString(payload["body_text"]) ??
      asString(payload["body"]);

    const customerEmail =
      asString(getNested(payload, "ticket", "customer", "email")) ??
      asString(getNested(payload, "customer", "email")) ??
      undefined;

    const customerId =
      asString(getNested(payload, "ticket", "customer", "id")) ??
      asString(getNested(payload, "customer", "id")) ??
      undefined;

    if (!ticketId || !messageText) {
      console.warn("[GorgiasWebhook] FAIL step=payload_parse", {
        ticketId,
        hasMessageText: !!messageText,
      });
      return NextResponse.json<IgnoredResponse>(
        { success: true, ignored: "missing_fields" },
        { status: 200 }
      );
    }

    const dryRun = process.env.DRY_RUN === "true" || process.env.DRY_RUN === "1";

    if (dryRun) {
      console.log("[GorgiasWebhook] DRY_RUN — skipping Abacus and Gorgias");
      console.log("[GorgiasWebhook] ABACUS_CALL_START (dry run)", { ticket: ticketId });
      console.log("[GorgiasWebhook] ABACUS_CALL_OK (dry run)", { ticket: ticketId });
      console.log("[GorgiasWebhook] GORGIAS_POST_START (dry run)", { ticket: ticketId });
      console.log("[GorgiasWebhook] GORGIAS_POST_OK (dry run)", { ticket: ticketId });
      return NextResponse.json<SuccessResponse>({
        success: true,
        ticket_id: ticketId,
        message_id: messageId ?? undefined,
        received_event: eventType ?? undefined,
        dry_run: true,
      });
    }

    // Gorgias HTTP integrations can time out quickly (e.g. 5s). We acknowledge immediately,
    // then process Abacus + Gorgias posting asynchronously in the background.
    // #region agent log
    fetch("http://127.0.0.1:7318/ingest/6e991345-16b8-41c6-b3bf-80cb1e473188", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6d486c" },
      body: JSON.stringify({
        sessionId: "6d486c",
        location: "route.ts:async_queued",
        message: "customer message queued for Abacus+Gorgias",
        data: { ticketId, hasEventContext: !!eventContext?.trim(), hypothesisId: "H1,H4" },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    void (async () => {
      try {
        const convStrategy = (process.env.ABACUS_CONV_KEY_STRATEGY || "ticket").trim().toLowerCase();
        const conversationId = convStrategy === "ticket" ? ticketId : ticketId;

        console.log("[GorgiasWebhook] ABACUS_CALL_START", { requestId, ticket: ticketId, messageLength: messageText.length });
        const answer = await getAbacusAnswer({
          conversationId,
          message: messageText,
          customerEmail,
          ticketId,
        });
        console.log("[GorgiasWebhook] ABACUS_RESPONSE", {
          requestId,
          ticket: ticketId,
          answerLength: answer.length,
          answerSample: answer.slice(0, 300),
        });

        console.log("[GorgiasWebhook] GORGIAS_POST_START", { requestId, ticket: ticketId });
        const gorgiasResponse = await postGorgiasMessage({
          ticketId,
          body: answer,
          eventContext,
          customerId,
          requestId,
        });
        console.log("[GorgiasWebhook] GORGIAS_POST_OK", {
          requestId,
          ticket: ticketId,
          delivery_ok: gorgiasResponse ? !gorgiasResponse.failed_datetime && !gorgiasResponse.last_sending_error : undefined,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[GorgiasWebhook] FAIL", { step: "async_handler", err: msg });
      }
    })();

    return NextResponse.json<SuccessResponse>({
      success: true,
      queued: true,
      ticket_id: ticketId,
      message_id: messageId ?? undefined,
      received_event: eventType ?? undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[GorgiasWebhook] FAIL", { step: "handler", err: msg });
    return NextResponse.json<ErrorResponse>(
      { success: false, error: msg },
      { status: 500 }
    );
  }
}

/** Reject other methods */
export async function GET(): Promise<NextResponse<ErrorResponse>> {
  return NextResponse.json(
    { success: false, error: "Method not allowed" },
    { status: 405 }
  );
}

export async function PUT(): Promise<NextResponse<ErrorResponse>> {
  return NextResponse.json(
    { success: false, error: "Method not allowed" },
    { status: 405 }
  );
}

export async function DELETE(): Promise<NextResponse<ErrorResponse>> {
  return NextResponse.json(
    { success: false, error: "Method not allowed" },
    { status: 405 }
  );
}
