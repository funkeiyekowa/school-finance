import { NextResponse } from "next/server";
import { processAlert } from "@/lib/alerts/processor";
import { createServiceClient, extractSecret, verifySmsSecret } from "@/lib/alerts/service";
import { rateLimit, callerKey } from "@/lib/api/rateLimit";
import { logError, requestContext } from "@/lib/errors/logError";

// Per-caller: 120 requests per minute. Real gateways forward at most a
// few per minute; anything above this is either a misconfigured retry
// loop or an abuse attempt, and either way we want it visible.
const SMS_RATE_MAX = 120;
const SMS_RATE_WINDOW_MS = 60_000;

/**
 * Receives bank alert SMS forwarded by the SMS Gateway Android app.
 *
 * Caller must present school_settings.sms_webhook_secret via one of:
 *   - x-webhook-secret / x-api-key header
 *   - Authorization: Bearer <secret>
 *   - ?secret=<secret> in the query string
 *   - a "secret" field in the request body
 * Configure it once in Setup → SMS Alerts and paste it into your gateway.
 *
 * This route only normalises the various gateway payload shapes; all
 * parsing, matching and ledger posting lives in the shared processor so
 * SMS and email behave identically.
 */
export async function POST(request: Request) {
  // Rate limit BEFORE reading the body. A caller that's already tripped
  // the limit shouldn't get to burn service-role queries on secret
  // verification. IP-based; not perfect on serverless (each instance
  // has its own bucket) but strong enough to make sustained abuse
  // visible in error_log.
  const ip = callerKey(request);
  const rl = rateLimit({ name: "sms-webhook", key: ip, max: SMS_RATE_MAX, windowMs: SMS_RATE_WINDOW_MS });
  if (!rl.allowed) {
    await logError({
      source: "sms-webhook",
      severity: "warn",
      message: `Rate limit exceeded (${rl.currentCount} requests in the current window)`,
      context: { limit: SMS_RATE_MAX, windowMs: SMS_RATE_WINDOW_MS },
      ...requestContext(request),
    });
    return NextResponse.json(
      { error: "Rate limit exceeded." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  const supabase = createServiceClient();

  let body: Record<string, any>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  // Refuse anything without the configured shared secret. Without this
  // gate, anyone who knows the URL can POST fake bank alerts that get
  // recorded as real income against a random student.
  const check = await verifySmsSecret(supabase, extractSecret(request, body));
  if (!check.ok) {
    // Log auth failures — bursts here are the shape of a
    // secret-guessing attempt.
    await logError({
      source: "sms-webhook",
      severity: "warn",
      message: `Unauthorized: ${check.message ?? "no secret"}`,
      context: { status: check.status },
      ...requestContext(request),
    });
    return NextResponse.json({ error: check.message ?? "Unauthorized" }, { status: check.status });
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
    await logError({
      source: "sms-webhook",
      severity: "error",
      message,
      stack: err instanceof Error ? err.stack : null,
      context: { sender: normalised.sender, messageLen: normalised.messageText?.length ?? 0 },
      ...requestContext(request),
    });
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
