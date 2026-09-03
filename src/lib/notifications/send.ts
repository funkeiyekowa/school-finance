/**
 * src/lib/notifications/send.ts
 *
 * The abstraction layer Communication > Announcements will call once a
 * school has configured an SMS and/or email provider on
 * /dashboard/announcements/broadcast-settings (see
 * supabase/broadcast_channels_module.sql -> notification_providers,
 * and /api/notifications/provider-settings).
 *
 * STATUS: scaffolding only. sendSms() / sendEmail() below correctly
 * load and decrypt a school's stored provider settings and correctly
 * refuse to run when nothing is configured, but the actual outbound
 * HTTP call to each provider (Termii, Africa's Talking, Twilio,
 * webhook / Resend, SendGrid, SMTP) is not implemented yet -- that
 * needs a real account + API key for at least one provider per
 * channel to build and test against, which the platform does not
 * have. Wiring one in is a small, mechanical change once Deji has
 * picked a provider and pasted a key into the settings page: fill in
 * the matching case below with that provider's actual send call.
 *
 * This file is intentionally NOT wired into the Announcements UI yet
 * (the Broadcast modal's SMS/Email cards link to the settings page,
 * not to this file) -- wiring it in is the very next step once a
 * provider is chosen, so "Send" on those cards starts doing something
 * instead of nothing.
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

  let apiKey: string;
  try {
    apiKey = decryptProviderKey(row.sms_api_key_ciphertext);
  } catch {
    return { ok: false, sent: 0, failed: recipients.length, error: "Stored SMS credentials could not be read. Please re-enter the API key in Broadcast Channels settings." };
  }

  switch (row.sms_provider) {
    case "termii":
    case "africastalking":
    case "twilio":
    case "webhook":
      // TODO: implement the actual provider call once Deji has a real
      // account for at least one of these. Shape to follow:
      //   const senderId = row.sms_sender_id;
      //   const extra = row.sms_extra ?? {};
      //   for each recipient: POST to the provider's send-SMS endpoint
      //   with apiKey / senderId / extra, tally sent vs failed.
      return {
        ok: false,
        sent: 0,
        failed: recipients.length,
        error: `SMS provider "${row.sms_provider}" is configured but sending isn't wired up yet -- this needs the provider integration to be built (see src/lib/notifications/send.ts).`,
      };
    default:
      return { ok: false, sent: 0, failed: recipients.length, error: `Unknown SMS provider "${row.sms_provider}".` };
  }
}

/**
 * Send an email broadcast to a list of addresses using the school's
 * own configured provider. Same "configured but not wired up" shape
 * as sendSms() until a real provider account exists to build against.
 */
export async function sendEmail(organizationId: string, recipients: string[], subject: string, body: string): Promise<SendResult> {
  const row = await loadProviderRow(organizationId);
  if (!row?.email_provider || !row.email_api_key_ciphertext) {
    return { ok: false, sent: 0, failed: recipients.length, error: "No email provider is configured for this school yet." };
  }

  let apiKey: string;
  try {
    apiKey = decryptProviderKey(row.email_api_key_ciphertext);
  } catch {
    return { ok: false, sent: 0, failed: recipients.length, error: "Stored email credentials could not be read. Please re-enter the API key in Broadcast Channels settings." };
  }

  switch (row.email_provider) {
    case "resend":
    case "sendgrid":
    case "smtp":
      // TODO: implement the actual provider call once Deji has a real
      // account for at least one of these. Shape to follow:
      //   const from = `${row.email_from_name ?? "School"} <${row.email_from_address ?? "no-reply@school"}>`;
      //   for each recipient: POST to the provider's send-email endpoint
      //   (or open an SMTP connection for "smtp") with apiKey / from,
      //   tally sent vs failed.
      return {
        ok: false,
        sent: 0,
        failed: recipients.length,
        error: `Email provider "${row.email_provider}" is configured but sending isn't wired up yet -- this needs the provider integration to be built (see src/lib/notifications/send.ts).`,
      };
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
