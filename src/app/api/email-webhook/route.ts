import { NextResponse } from "next/server";
import { htmlToText } from "@/lib/alerts/parser";
import { processAlert } from "@/lib/alerts/processor";
import { createServiceClient, extractSecret, verifyEmailSecret } from "@/lib/alerts/service";
import { rateLimit, callerKey } from "@/lib/api/rateLimit";
import { logError, requestContext } from "@/lib/errors/logError";

// Per-caller: 60 requests per minute. Gmail Apps Script forwards at
// most one message per email received; a healthy school gets a
// handful per day. Anything above this window is a runaway retry
// or an abuse attempt.
const EMAIL_RATE_MAX = 60;
const EMAIL_RATE_WINDOW_MS = 60_000;

/**
 * Receives bank alert emails forwarded by the Gmail Apps Script.
 *
 * Runs the same pipeline as the SMS webhook — the only email-specific work
 * is authenticating the caller and reducing the message to plain text.
 */
export async function POST(request: Request) {
  const ip = callerKey(request);
  const rl = rateLimit({ name: "email-webhook", key: ip, max: EMAIL_RATE_MAX, windowMs: EMAIL_RATE_WINDOW_MS });
  if (!rl.allowed) {
    await logError({
      source: "email-webhook",
      severity: "warn",
      message: `Rate limit exceeded (${rl.currentCount} requests in the current window)`,
      context: { limit: EMAIL_RATE_MAX, windowMs: EMAIL_RATE_WINDOW_MS },
      ...requestContext(request),
    });
    return NextResponse.json(
      { error: "Rate limit exceeded." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  const supabase = createServiceClient();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const check = await verifyEmailSecret(supabase, extractSecret(request, body));
  if (!check.ok) {
    await logError({
      source: "email-webhook",
      severity: "warn",
      message: `Unauthorized: ${check.message ?? "no secret"}`,
      context: { status: check.status },
      ...requestContext(request),
    });
    return NextResponse.json({ error: check.message }, { status: check.status });
  }

  const settings = check.settings!;
  const organizationId = settings.organization_id;
  if (typeof organizationId !== "string") {
    return NextResponse.json({ error: "School settings are missing an organization." }, { status: 500 });
  }
  if (settings.email_alerts_enabled !== true) {
    return NextResponse.json({
      success: false,
      skipped: true,
      reason: "Email alerts are disabled in Setup → Email Alerts.",
    });
  }

  // Accept a few field spellings so the endpoint also works with generic
  // inbound-email services, not just our Apps Script.
  const str = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = body[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  };

  const from = str("from", "sender", "fromAddress", "From");
  const subject = str("subject", "Subject") ?? "";
  const plainBody = str("body", "text", "plain", "bodyPlain", "textBody");
  const htmlBody = str("html", "bodyHtml", "htmlBody");
  const messageId = str("messageId", "message_id", "id", "gmailMessageId");
  const receivedAtRaw = str("receivedAt", "date", "timestamp", "received_at");

  // Prefer the plain-text part; bank emails that are HTML-only get stripped.
  const messageText = plainBody || (htmlBody ? htmlToText(htmlBody) : null);

  if (!messageText) {
    return NextResponse.json(
      {
        error: "No email body provided.",
        debug: { receivedKeys: Object.keys(body) },
      },
      { status: 400 }
    );
  }

  // The Gmail message id is stable across retries, which is what makes
  // redelivery safe. Fall back to a content hash if it's missing.
  const externalId = messageId
    ? `email-${messageId}`
    : `email-${hashString(`${from}|${subject}|${messageText}`)}`;

  let receivedAt = new Date().toISOString();
  if (receivedAtRaw) {
    const parsedDate = new Date(receivedAtRaw);
    if (!isNaN(parsedDate.getTime())) receivedAt = parsedDate.toISOString();
  }

  // History cutoff, enforced here as well as in the script. A bank alert
  // label often holds years of old mail; replaying it would back-post
  // thousands of transactions. The script filters by date too, but an
  // outdated or hand-edited script must not be able to bypass this.
  // Falls back to today when unset, which also covers the window before
  // the migration adds the column. Defaulting to "no cutoff" here would let
  // a label full of old alerts back-post itself.
  const startDate =
    (settings.email_start_date as string | null) ?? new Date().toISOString().substring(0, 10);
  if (startDate) {
    const cutoff = new Date(`${startDate}T00:00:00Z`);
    if (!isNaN(cutoff.getTime()) && new Date(receivedAt) < cutoff) {
      return NextResponse.json({
        success: false,
        skipped: true,
        reason: `Email is dated ${receivedAt.substring(0, 10)}, before the ${startDate} start date in Setup → Email Alerts. Ignored as history.`,
      });
    }
  }

  // Subject filtering happens here as well as in the script, so a
  // misconfigured or stale script can't push through unwanted mail.
  const keywords = String(settings.email_subject_keywords ?? "")
    .split(",")
    .map(k => k.trim().toLowerCase())
    .filter(Boolean);
  if (keywords.length > 0) {
    const haystack = `${subject} ${messageText}`.toLowerCase();
    if (!keywords.some(k => haystack.includes(k))) {
      return NextResponse.json({
        success: false,
        skipped: true,
        reason: `Subject "${subject}" does not match any configured keyword. Email ignored.`,
      });
    }
  }

  try {
    const result = await processAlert(supabase, {
      organizationId,
      channel: "email",
      sender: from,
      messageText,
      receivedAt,
      externalId,
      messageId: externalId,
      subject,
      rawPayload: body,
    });

    if (result.success && !result.skipped) {
      await supabase
        .from("school_settings")
        .update({
          email_last_received_at: new Date().toISOString(),
          email_total_received: (Number(settings.email_total_received) || 0) + 1,
        })
        .eq("id", settings.id as string);
    }

    return NextResponse.json(result, { status: result.error ? 500 : 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    await logError({
      source: "email-webhook",
      severity: "error",
      message,
      stack: err instanceof Error ? err.stack : null,
      context: { from, subject, messageLen: messageText?.length ?? 0 },
      ...requestContext(request),
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Health check + self-documentation for anyone hitting the URL directly. */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "Bank Email Alert Webhook",
    auth: "Send the shared secret in an 'x-webhook-secret' header.",
    usage: "POST JSON with { from, subject, body | html, messageId, receivedAt }.",
    example: {
      from: "alerts@fidelitybank.com",
      subject: "Transaction Alert",
      body: "Acct:**3387 CR:N22,000.00 Desc:S327 Aimien Samuel DT:05/MAY/26 08:24AM",
      messageId: "gmail-message-id",
    },
  });
}

/** Small non-cryptographic hash for fallback idempotency keys. */
function hashString(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}
