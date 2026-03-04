import { NextRequest, NextResponse } from "next/server";

/** Minimal type for Gorgias webhook payload (message.from_agent check) */
interface GorgiasWebhookPayload {
  message?: {
    from_agent?: boolean;
  };
  event?: string;
  [key: string]: unknown;
}

/** Response when the message is from an agent and we ignore it */
interface IgnoredResponse {
  success: true;
  ignored: "agent_message";
}

/** Response when we accept the event */
interface ReceivedResponse {
  success: true;
  received_event: string;
}

/** Error response shape */
interface ErrorResponse {
  success: false;
  error: string;
}

type WebhookResponse = IgnoredResponse | ReceivedResponse | ErrorResponse;

export async function POST(request: NextRequest): Promise<NextResponse<WebhookResponse>> {
  try {
    const body = await request.json();
    const payload = body as GorgiasWebhookPayload;

    const fromAgent = payload?.message?.from_agent === true;
    if (fromAgent) {
      return NextResponse.json<IgnoredResponse>({
        success: true,
        ignored: "agent_message",
      });
    }

    const eventType = typeof payload?.event === "string" && payload.event
      ? payload.event
      : "ticket-message-created";

    return NextResponse.json<ReceivedResponse>({
      success: true,
      received_event: eventType,
    });
  } catch {
    return NextResponse.json<ErrorResponse>(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
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
