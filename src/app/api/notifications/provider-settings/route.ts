/**
 * GET/POST /api/notifications/provider-settings
 *
 * Per-school SMS and email broadcast provider settings -- lets an org
 * admin plug in their own Termii / Africa's Talking / Twilio / generic
 * webhook SMS account, and their own Resend / SendGrid / SMTP email
 * account, so Communication > Announcements can actually send instead
 * of only offering the manual copy/CSV/WhatsApp-link assist tools.
 *
 * Same shape as /api/ai/org-settings: GET returns the non-secret
 * fields only (never the API key itself, not even to the admin who
 * set it -- only "configured: true/false"); POST is the only path
 * that can write a key, and only after encrypting it server-side
 * with the same AES-256-GCM helper the AI provider settings already
 * use (see @/lib/ai/keyCrypto -- generic despite the ai/ path, reused
 * here rather than duplicated).
 *
 * This route does NOT send anything. It only stores credentials.
 * Actual sending (once a school has configured a provider) is
 * src/lib/notifications/send.ts's job.
 */

import { NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/api/requireStaff";
import { createClient } from "@/lib/supabase/server";
import { logError, requestContext } from "@/lib/errors/logError";
import { encryptProviderKey } from "@/lib/ai/keyCrypto";

const SMS_PROVIDERS = new Set(["termii", "africastalking", "twilio", "webhook"]);
const EMAIL_PROVIDERS = new Set(["resend", "sendgrid", "smtp"]);

interface PostBody {
  organizationId?: string;

  smsProvider?: string | "" | null;   // "" or null = clear
  smsSenderId?: string | null;
  smsApiKey?: string | null;          // present + non-empty = set/replace; absent = leave as-is; "" = clear
  smsExtra?: Record<string, unknown> | null;

  emailProvider?: string | "" | null;
  emailFromAddress?: string | null;
  emailFromName?: string | null;
  emailApiKey?: string | null;
  emailExtra?: Record<string, unknown> | null;
}

export async function GET(request: Request) {
  const guard = await requireStaffSession();
  if (guard) return guard;

  const url = new URL(request.url);
  const organizationId = url.searchParams.get("organizationId");
  if (!organizationId) {
    return NextResponse.json({ error: "organizationId is required." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_notification_provider_settings").maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }

  return NextResponse.json({
    settings: data ?? {
      sms_provider: null, sms_sender_id: null, sms_configured: false, sms_configured_at: null,
      email_provider: null, email_from_address: null, email_from_name: null,
      email_configured: false, email_configured_at: null,
    },
  });
}

export async function POST(request: Request) {
  const guard = await requireStaffSession();
  if (guard) return guard;

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const { organizationId } = body;
  if (!organizationId) {
    return NextResponse.json({ error: "organizationId is required." }, { status: 400 });
  }
  if (body.smsProvider && !SMS_PROVIDERS.has(body.smsProvider)) {
    return NextResponse.json({ error: "Unknown SMS provider id." }, { status: 400 });
  }
  if (body.emailProvider && !EMAIL_PROVIDERS.has(body.emailProvider)) {
    return NextResponse.json({ error: "Unknown email provider id." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Belt-and-braces re-check, same as org-settings: never trust the
  // client's own org-switch state for a write like this.
  const { data: isAdmin, error: adminCheckError } = await supabase.rpc("_is_org_admin_for", { p_org: organizationId });
  if (adminCheckError || !isAdmin) {
    return NextResponse.json({ error: "Not authorized for this school." }, { status: 403 });
  }

  const svcUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!svcUrl || !svcKey) {
    return NextResponse.json({ error: "Server is missing its service-role configuration." }, { status: 500 });
  }

  const { createClient: createServiceClient } = await import("@supabase/supabase-js");
  const svc = createServiceClient(svcUrl, svcKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const update: Record<string, unknown> = { organization_id: organizationId };

  if (body.smsProvider !== undefined) {
    update.sms_provider = body.smsProvider || null;
  }
  if (body.smsSenderId !== undefined) {
    update.sms_sender_id = body.smsSenderId || null;
  }
  if (body.smsExtra !== undefined) {
    update.sms_extra = body.smsExtra ?? {};
  }
  if (body.smsApiKey !== undefined) {
    if (body.smsApiKey === "" || body.smsApiKey === null) {
      update.sms_api_key_ciphertext = null;
      update.sms_configured_at = null;
      update.sms_configured_by = null;
    } else {
      try {
        update.sms_api_key_ciphertext = encryptProviderKey(body.smsApiKey);
        update.sms_configured_at = new Date().toISOString();
        update.sms_configured_by = user?.id ?? null;
      } catch (err) {
        await logError({
          source: "notification-provider-settings", severity: "error",
          message: err instanceof Error ? err.message : "Failed to encrypt SMS API key",
          organizationId, ...requestContext(request),
        });
        return NextResponse.json(
          { error: "Server cannot store API keys right now (encryption is not configured). Contact the platform admin." },
          { status: 500 },
        );
      }
    }
  }

  if (body.emailProvider !== undefined) {
    update.email_provider = body.emailProvider || null;
  }
  if (body.emailFromAddress !== undefined) {
    update.email_from_address = body.emailFromAddress || null;
  }
  if (body.emailFromName !== undefined) {
    update.email_from_name = body.emailFromName || null;
  }
  if (body.emailExtra !== undefined) {
    update.email_extra = body.emailExtra ?? {};
  }
  if (body.emailApiKey !== undefined) {
    if (body.emailApiKey === "" || body.emailApiKey === null) {
      update.email_api_key_ciphertext = null;
      update.email_configured_at = null;
      update.email_configured_by = null;
    } else {
      try {
        update.email_api_key_ciphertext = encryptProviderKey(body.emailApiKey);
        update.email_configured_at = new Date().toISOString();
        update.email_configured_by = user?.id ?? null;
      } catch (err) {
        await logError({
          source: "notification-provider-settings", severity: "error",
          message: err instanceof Error ? err.message : "Failed to encrypt email API key",
          organizationId, ...requestContext(request),
        });
        return NextResponse.json(
          { error: "Server cannot store API keys right now (encryption is not configured). Contact the platform admin." },
          { status: 500 },
        );
      }
    }
  }

  const { error: upsertError } = await svc
    .from("notification_providers")
    .upsert(update, { onConflict: "organization_id" });

  if (upsertError) {
    await logError({
      source: "notification-provider-settings", severity: "error",
      message: upsertError.message, organizationId, ...requestContext(request),
    });
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
