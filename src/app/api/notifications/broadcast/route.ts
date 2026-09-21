/**
 * POST /api/notifications/broadcast
 *
 * Sends an announcement out over the school's configured SMS and/or email
 * provider(s). This is the piece that was missing between
 * notification_providers (storage, complete) and send.ts (dispatch, now
 * implemented): resolving WHO to send to for a given announcement scope,
 * then calling sendSms()/sendEmail() and returning a tally the Broadcast
 * modal can show the admin.
 *
 * Recipients come from get_broadcast_recipients() (see
 * supabase/notification_delivery_rpcs.sql), which mirrors
 * broadcast_announcement_to_inbox()'s own scope resolution exactly, so
 * "parents" (for example) means the same population whether the channel is
 * in-app, SMS, or email.
 *
 * Auth: requireStaffSession() -- same guard as
 * /api/notifications/provider-settings. get_broadcast_recipients() ALSO
 * re-checks is_staff_user() + is_org_admin() itself (SECURITY DEFINER,
 * does not trust this route's own check alone), so a caller who somehow
 * bypassed the route-level guard would still be refused by the database.
 */

import { NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/api/requireStaff";
import { createClient } from "@/lib/supabase/server";
import { logError, requestContext } from "@/lib/errors/logError";
import { sendSms, sendEmail, type SendResult } from "@/lib/notifications/send";

interface PostBody {
  organizationId?: string;
  title?: string;
  body?: string;
  scope?: "all" | "staff" | "parents" | "students" | "class";
  classId?: string | null;
  channel?: "sms" | "email";
}

export async function POST(request: Request) {
  const guard = await requireStaffSession();
  if (guard) return guard;

  let payload: PostBody;
  try {
    payload = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const { organizationId, title, body, scope, classId, channel } = payload;
  if (!organizationId || !title?.trim() || !body?.trim() || !scope || !channel) {
    return NextResponse.json(
      { error: "organizationId, title, body, scope and channel are all required." },
      { status: 400 }
    );
  }
  if (channel !== "sms" && channel !== "email") {
    return NextResponse.json({ error: "channel must be \"sms\" or \"email\"." }, { status: 400 });
  }

  const supabase = await createClient();

  // Belt-and-braces re-check, same as provider-settings: never trust the
  // client's own org-switch state for an action that sends real messages.
  const { data: isAdmin, error: adminCheckError } = await supabase.rpc("_is_org_admin_for", { p_org: organizationId });
  if (adminCheckError || !isAdmin) {
    return NextResponse.json({ error: "Not authorized for this school." }, { status: 403 });
  }

  const { data: recipientRows, error: recipientsError } = await supabase.rpc("get_broadcast_recipients", {
    p_scope: scope, p_class_id: scope === "class" ? classId : null,
  });
  if (recipientsError) {
    await logError({
      source: "notifications-broadcast", severity: "error",
      message: recipientsError.message, organizationId, ...requestContext(request),
    });
    return NextResponse.json({ error: recipientsError.message }, { status: 403 });
  }

  const rows = (recipientRows ?? []) as { user_id: string; phone: string | null; email: string | null }[];

  let result: SendResult;
  if (channel === "sms") {
    const phones = Array.from(new Set(rows.map((r) => r.phone).filter((p): p is string => Boolean(p?.trim()))));
    result = await sendSms(organizationId, phones, `${title.trim()}\n\n${body.trim()}`);
  } else {
    const emails = Array.from(new Set(rows.map((r) => r.email).filter((e): e is string => Boolean(e?.trim()))));
    result = await sendEmail(organizationId, emails, title.trim(), body.trim());
  }

  if (!result.ok && result.sent === 0 && result.failed === 0) {
    // Not configured / credentials unreadable -- nothing was attempted.
    return NextResponse.json({ error: result.error ?? "Broadcast could not be sent." }, { status: 409 });
  }

  if (result.failed > 0) {
    await logError({
      source: "notifications-broadcast", severity: result.sent > 0 ? "warn" : "error",
      message: result.error ?? `${result.failed} recipient(s) failed`,
      organizationId, ...requestContext(request),
    });
  }

  return NextResponse.json({ ok: result.ok, sent: result.sent, failed: result.failed, error: result.error });
}
