import { NextResponse } from "next/server";
import { processAlert } from "@/lib/alerts/processor";
import { createServiceClient } from "@/lib/alerts/service";

/**
 * Receives bank alert SMS forwarded by the SMS Gateway Android app.
 *
 * This route only normalises the various gateway payload shapes; all
 * parsing, matching and ledger posting lives in the shared processor so
 * SMS and email behave identically.
 */
export async function POST(request: Request) {
  const supabase = createServiceClient();

  let body: Record<string, any>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const normalised = normaliseGatewayPayload(body);

  if (!normalised.messageText) {
    return NextResponse.json(
      {
        error: "No message text provided",
        debug: {
          hasEvent: !!body.event,
          hasPayload: !!body.payload,
          payloadType: typeof body.payload,
          bodyKeys: Object.keys(body),
        },
      },
      { status: 400 }
    );
  }

  try {
    const result = await processAlert(supabase, {
      channel: "sms",
      sender: normalised.sender,
      messageText: normalised.messageText,
      receivedAt: normalised.receivedAt,
      externalId: normalised.eventId,
      messageId: normalised.messageId,
      deviceId: normalised.deviceId,
      simNumber: normalised.simNumber,
      rawPayload: body,
    });

    return NextResponse.json(result, { status: result.error ? 500 : 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("SMS webhook error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

interface NormalisedSms {
  sender: string | null;
  messageText: string;
  receivedAt: string;
  deviceId: string | null;
  simNumber: number | null;
  eventId: string;
  messageId: string;
}

/**
 * Flatten the payload shapes we've seen in the wild into one structure:
 *  - SMS Gate (sms-gate.app): { event, deviceId, payload: { message, sender, ... } }
 *  - Same, but with `payload` delivered as a JSON string
 *  - Simple forwarders: { sender | from | phone, message | text | body }
 */
function normaliseGatewayPayload(body: Record<string, any>): NormalisedSms {
  const fallbackId = `sms-${Date.now()}`;

  const fromPayload = (p: Record<string, any>): NormalisedSms => ({
    sender: p.sender ?? p.from ?? null,
    messageText: p.message ?? p.text ?? "",
    receivedAt: normaliseDate(p.receivedAt),
    deviceId: body.deviceId ?? null,
    simNumber: p.simNumber ?? null,
    eventId: body.id ?? fallbackId,
    messageId: p.messageId ?? body.id ?? fallbackId,
  });

  if (body.event && body.payload && typeof body.payload === "object") {
    return fromPayload(body.payload);
  }

  if (body.payload && typeof body.payload === "string") {
    try {
      return fromPayload(JSON.parse(body.payload));
    } catch {
      return {
        sender: body.sender ?? null,
        messageText: body.payload,
        receivedAt: normaliseDate(null),
        deviceId: body.deviceId ?? null,
        simNumber: null,
        eventId: body.id ?? fallbackId,
        messageId: body.id ?? fallbackId,
      };
    }
  }

  return {
    sender: body.sender ?? body.from ?? body.phone ?? body.sender_number ?? null,
    messageText: body.message ?? body.text ?? body.body ?? body.smsBody ?? "",
    receivedAt: normaliseDate(
      body.timestamp ?? body.sentStamp ?? body.received_at ?? body.receivedAt
    ),
    deviceId: body.device_id ?? body.deviceId ?? body.device ?? null,
    simNumber: body.sim ?? body.simNumber ?? body.sim_number ?? null,
    eventId: body.event_id ?? body.eventId ?? body.id ?? fallbackId,
    messageId: body.message_id ?? body.messageId ?? body.msgId ?? fallbackId,
  };
}

function normaliseDate(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

/** Health check + self-documentation. */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "SMS Payment Webhook",
    usage: "POST a JSON body with { sender, message } to process a bank alert SMS.",
    example: {
      sender: "+2348012345678",
      message: "Acct:**3387 CR:N22,000.00 Desc:S327 Aimien Samuel DT:05/MAY/26 08:24AM",
    },
  });
}
