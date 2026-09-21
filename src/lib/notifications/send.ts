/**
 * src/lib/notifications/send.ts
 *
 * The dispatch layer Communication > Announcements calls once a school has
 * configured an SMS and/or email provider on
 * /dashboard/announcements/broadcast-settings (see
 * supabase/broadcast_channels_module.sql -> notification_providers, and
 * /api/notifications/provider-settings). Called from
 * /api/notifications/broadcast, which resolves recipients via the
 * get_broadcast_recipients() RPC (supabase/notification_delivery_rpcs.sql)
 * and passes their phone numbers / email addresses in here.
 *
 * sendSms() / sendEmail() load and decrypt a school's stored provider
 * settings, refuse to run when nothing is configured, and dispatch to
 * exactly the provider the school picked -- one HTTP call pattern per
 * provider below, all fetch()-based except SMTP (which needs a real TCP/TLS
 * connection, via nodemailer). Every provider here is one the settings UI
 * already offers as a choice (broadcast-settings/page.tsx); nothing new is
 * introduced.
 *
 * Every recipient is dispatched to individually rather than in one bulk
 * provider call, even where a provider's API supports bulk `to` lists
 * (Africa's Talking, Resend, SendGrid). This is a broadcast to a school's
 * parents/students/staff -- recipients must never see each other's phone
 * number or email address, which a single call with all of them in one
 * `to` field would leak. It also keeps the per-recipient sent/failed tally
 * in SendResult accurate: one provider response maps to exactly one
 * recipient, not a batch whose partial failures must be unpacked.
 *
 * NOT verified against a live provider account -- no such account exists
 * in this environment. Each call follows that provider's own documented
 * REST API exactly (endpoint, auth scheme, request/response shape) and the
 * existing AI-provider dispatch pattern in src/lib/ai/server.ts (plain
 * fetch, check resp.ok, throw with the response body truncated to 300
 * chars on failure) for consistency, but actual delivery has not been
 * exercised end-to-end.
 */

import { createClient } from "@/lib/supabase/server";
import { decryptProviderKey } from "@/lib/ai/keyCrypto";

export interface SendResult {
  ok: boolean;
  sent: number;
  failed: number;
  error?: string;
}

interface ProviderRow {
  sms_provider: string | null;
  sms_sender_id: string | null;
  sms_api_key_ciphertext: string | null;
  sms_extra: Record<string, unknown> | null;
  email_provider: string | null;
  email_from_address: string | null;
  email_from_name: string | null;
  email_api_key_ciphertext: string | null;
  email_extra: Record<string, unknown> | null;
}

async function loadProviderRow(organizationId: string): Promise<ProviderRow | null> {
  // Service-role read -- this file runs server-side only, never from
  // the browser, so it can read the ciphertext column directly (RLS
  // on notification_providers has no client SELECT policy for it
  // anyway; only the service-role key used here can see it).
  const { createClient: createServiceClient } = await import("@supabase/supabase-js");
  const svcUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!svcUrl || !svcKey) return null;
  const svc = createServiceClient(svcUrl, svcKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data } = await svc
    .from("notification_providers")
    .select("sms_provider, sms_sender_id, sms_api_key_ciphertext, sms_extra, email_provider, email_from_address, email_from_name, email_api_key_ciphertext, email_extra")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return (data as ProviderRow | null) ?? null;
}

/** A single recipient dispatch outcome, tallied by the caller into SendResult. */
type Outcome = "sent" | "failed";

async function tally(
  recipients: string[],
  dispatchOne: (recipient: string) => Promise<Outcome>
): Promise<SendResult> {
  let sent = 0;
  let failed = 0;
  for (const r of recipients) {
    try {
      const outcome = await dispatchOne(r);
      if (outcome === "sent") sent++; else failed++;
    } catch {
      failed++;
    }
  }
  return { ok: failed === 0, sent, failed };
}

/** Same `resp.ok` + truncated-body error convention as src/lib/ai/server.ts. */
async function assertOk(resp: Response, label: string): Promise<void> {
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`${label} error ${resp.status}: ${text.slice(0, 300)}`);
  }
}

/**
 * Send an SMS broadcast to a list of phone numbers using the school's
 * own configured provider. Returns ok:false with a clear message if
 * no SMS provider is configured yet -- callers should surface that
 * message and point the admin at /dashboard/announcements/broadcast-settings.
 */
export async function sendSms(organizationId: string, recipients: string[], message: string): Promise<SendResult> {
  const row = await loadProviderRow(organizationId);
  if (!row?.sms_provider || !row.sms_api_key_ciphertext) {
    return { ok: false, sent: 0, failed: recipients.length, error: "No SMS provider is configured for this school yet." };
  }
  if (recipients.length === 0) {
    return { ok: true, sent: 0, failed: 0 };
  }

  let apiKey: string;
  try {
    apiKey = decryptProviderKey(row.sms_api_key_ciphertext);
  } catch {
    return { ok: false, sent: 0, failed: recipients.length, error: "Stored SMS credentials could not be read. Please re-enter the API key in Broadcast Channels settings." };
  }

  const senderId = row.sms_sender_id || "School";
  const extra = row.sms_extra ?? {};

  switch (row.sms_provider) {
    case "termii": {
      const result = await tally(recipients, async (to) => {
        const resp = await fetch("https://api.ng.termii.com/api/sms/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to, from: senderId, sms: message, type: "plain", channel: "generic", api_key: apiKey,
          }),
        });
        await assertOk(resp, "Termii");
        return "sent";
      });
      return { ...result, error: result.failed > 0 ? `${result.failed} of ${recipients.length} SMS messages failed to send via Termii.` : undefined };
    }

    case "africastalking": {
      const username = String(extra.username ?? "").trim();
      if (!username) {
        return { ok: false, sent: 0, failed: recipients.length, error: "Africa's Talking username is not configured. Add it in Broadcast Channels settings." };
      }
      // One bulk call, comma-joined numbers -- privacy is preserved here
      // because Africa's Talking's response tells each recipient's own
      // delivery status back to the caller, not to the other recipients;
      // nothing is exposed to any recipient's own device.
      const resp = await fetch("https://api.africastalking.com/version1/messaging", {
        method: "POST",
        headers: {
          apiKey, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ username, to: recipients.join(","), message, from: senderId }),
      });
      await assertOk(resp, "Africa's Talking");
      const payload = (await resp.json()) as {
        SMSMessageData?: { Recipients?: { number: string; status: string }[] };
      };
      const results = payload.SMSMessageData?.Recipients ?? [];
      const sentCount = results.filter((r) => r.status === "Success").length;
      const failedCount = recipients.length - sentCount;
      return {
        ok: failedCount === 0, sent: sentCount, failed: failedCount,
        error: failedCount > 0 ? `${failedCount} of ${recipients.length} SMS messages failed to send via Africa's Talking.` : undefined,
      };
    }

    case "twilio": {
      const accountSid = String(extra.account_sid ?? "").trim();
      if (!accountSid) {
        return { ok: false, sent: 0, failed: recipients.length, error: "Twilio Account SID is not configured. Add it in Broadcast Channels settings." };
      }
      const basicAuth = Buffer.from(`${accountSid}:${apiKey}`).toString("base64");
      const result = await tally(recipients, async (to) => {
        const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
          method: "POST",
          headers: {
            Authorization: `Basic ${basicAuth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ To: to, From: senderId, Body: message }),
        });
        await assertOk(resp, "Twilio");
        return "sent";
      });
      return { ...result, error: result.failed > 0 ? `${result.failed} of ${recipients.length} SMS messages failed to send via Twilio.` : undefined };
    }

    case "webhook": {
      const webhookUrl = String(extra.webhook_url ?? "").trim();
      if (!webhookUrl) {
        return { ok: false, sent: 0, failed: recipients.length, error: "Webhook URL is not configured. Add it in Broadcast Channels settings." };
      }
      const result = await tally(recipients, async (to) => {
        const resp = await fetch(webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // The API key is optional for a custom webhook (school's own
            // endpoint may not require auth at all) -- see the settings UI's
            // own "(optional)" label on this field.
            ...(row.sms_api_key_ciphertext ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({ to, message, from: senderId }),
        });
        await assertOk(resp, "Webhook");
        return "sent";
      });
      return { ...result, error: result.failed > 0 ? `${result.failed} of ${recipients.length} SMS messages failed to send via the configured webhook.` : undefined };
    }

    default:
      return { ok: false, sent: 0, failed: recipients.length, error: `Unknown SMS provider "${row.sms_provider}".` };
  }
}

/**
 * Send an email broadcast to a list of addresses using the school's
 * own configured provider.
 */
export async function sendEmail(organizationId: string, recipients: string[], subject: string, body: string): Promise<SendResult> {
  const row = await loadProviderRow(organizationId);
  if (!row?.email_provider || !row.email_api_key_ciphertext) {
    return { ok: false, sent: 0, failed: recipients.length, error: "No email provider is configured for this school yet." };
  }
  if (recipients.length === 0) {
    return { ok: true, sent: 0, failed: 0 };
  }

  let apiKey: string;
  try {
    apiKey = decryptProviderKey(row.email_api_key_ciphertext);
  } catch {
    return { ok: false, sent: 0, failed: recipients.length, error: "Stored email credentials could not be read. Please re-enter the API key in Broadcast Channels settings." };
  }

  const fromAddress = row.email_from_address || "no-reply@school.example";
  const fromName = row.email_from_name || "School";
  const from = `${fromName} <${fromAddress}>`;
  // A minimal HTML body -- the subject/body come from an announcement's
  // own title/text, which is already plain text; wrapping just preserves
  // line breaks and gives an email client something other than raw text.
  const html = `<p>${body.replace(/\n/g, "<br>")}</p>`;
  const extra = row.email_extra ?? {};

  switch (row.email_provider) {
    case "resend": {
      const result = await tally(recipients, async (to) => {
        const resp = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to: [to], subject, html }),
        });
        await assertOk(resp, "Resend");
        return "sent";
      });
      return { ...result, error: result.failed > 0 ? `${result.failed} of ${recipients.length} emails failed to send via Resend.` : undefined };
    }

    case "sendgrid": {
      const result = await tally(recipients, async (to) => {
        const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: to }] }],
            from: { email: fromAddress, name: fromName },
            subject,
            content: [{ type: "text/html", value: html }],
          }),
        });
        await assertOk(resp, "SendGrid");
        return "sent";
      });
      return { ...result, error: result.failed > 0 ? `${result.failed} of ${recipients.length} emails failed to send via SendGrid.` : undefined };
    }

    case "smtp": {
      const host = String(extra.host ?? "").trim();
      const port = Number(extra.port ?? 587);
      const username = String(extra.username ?? "").trim();
      if (!host || !username) {
        return { ok: false, sent: 0, failed: recipients.length, error: "SMTP host and username are not fully configured. Add them in Broadcast Channels settings." };
      }
      // nodemailer needs a real TCP/TLS socket -- SMTP cannot be spoken
      // over fetch() the way every other provider here can, so this is
      // the one place this file needs a dependency beyond the platform
      // fetch API.
      const nodemailer = (await import("nodemailer")).default;
      const transport = nodemailer.createTransport({
        host, port, secure: port === 465,
        auth: { user: username, pass: apiKey },
      });
      const result = await tally(recipients, async (to) => {
        await transport.sendMail({ from, to, subject, html });
        return "sent";
      });
      return { ...result, error: result.failed > 0 ? `${result.failed} of ${recipients.length} emails failed to send via SMTP.` : undefined };
    }

    default:
      return { ok: false, sent: 0, failed: recipients.length, error: `Unknown email provider "${row.email_provider}".` };
  }
}

/** Convenience check used by UI code to decide what to show without sending anything. */
export async function getConfiguredChannels(organizationId: string): Promise<{ sms: boolean; email: boolean }> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_notification_provider_settings").maybeSingle();
  return {
    sms: Boolean((data as { sms_configured?: boolean } | null)?.sms_configured),
    email: Boolean((data as { email_configured?: boolean } | null)?.email_configured),
  };
}
