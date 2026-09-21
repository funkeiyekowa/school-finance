/**
 * GET /api/cron/automations
 *
 * The execution/scheduling path Automations was missing. Runs once daily
 * via Vercel Cron (see vercel.json's `crons` array) -- Vercel's own native
 * scheduling primitive, already the platform this app deploys to, so this
 * adds no new infrastructure. Vercel Hobby limits cron invocations to once
 * per day; this route's SQL side (get_due_automation_triggers) is designed
 * around that from the start (see supabase/automation_engine.sql's own
 * notes on the last_executed_at idempotency window), not worked around.
 *
 * Auth: Vercel signs cron requests with `Authorization: Bearer
 * ${CRON_SECRET}` -- the platform's own documented convention, checked
 * against the CRON_SECRET env var. A request without a valid header is
 * refused before anything runs. There is no user session here; this route
 * always uses the service-role client, exactly as send.ts's own provider
 * lookup already does.
 *
 * Also accepts POST from a signed-in org admin (requireStaffSession + an
 * is_org_admin check), scoped to running ONLY that admin's own
 * organization's rules -- this is the "Run now" button on
 * /dashboard/automations, letting an admin test a rule immediately rather
 * than waiting for the next scheduled run.
 *
 * What actually executes each action type, and why:
 *   send_sms / send_email  -> src/lib/notifications/send.ts (the
 *     Notifications feature). Recipient is the matched student's
 *     students.guardian_phone / guardian_email -- students carries this
 *     directly, no extra join needed. Triggers with no student in their
 *     context (scheduled_daily) cannot resolve a single recipient this
 *     way and are skipped for these two action types, logged as a
 *     partial-failure "reason" rather than silently doing nothing.
 *   send_announcement -> broadcast_announcement_to_inbox() RPC (existing,
 *     working in-app inbox delivery from Communication > Announcements).
 *   log_activity / create_notification -> activity_log (existing table).
 *     Both intentionally use the same mechanism for now -- a distinct
 *     per-user "bell" notification experience is a deliberate follow-on
 *     decision, not something to invent speculatively here.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/api/requireStaff";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors/logError";
import { sendSms, sendEmail } from "@/lib/notifications/send";

interface DueTrigger {
  rule_id: string;
  organization_id: string;
  rule_name: string;
  trigger_event: string;
  actions: { type: string; template?: string; title?: string; body?: string; message?: string }[];
  context: Record<string, unknown>;
}

interface StudentContact {
  full_name: string | null;
  guardian_phone: string | null;
  guardian_email: string | null;
}

function serviceClient() {
  const svcUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!svcUrl || !svcKey) return null;
  // Deferred import matches the existing pattern in send.ts / logError.ts.
  return import("@supabase/supabase-js").then(({ createClient: create }) =>
    create(svcUrl, svcKey, { auth: { persistSession: false, autoRefreshToken: false } })
  );
}

async function resolveStudentContact(
  svc: NonNullable<Awaited<ReturnType<typeof serviceClient>>>,
  studentId: string | undefined
): Promise<StudentContact | null> {
  if (!studentId) return null;
  const { data } = await svc
    .from("students")
    .select("full_name, guardian_phone, guardian_email")
    .eq("id", studentId)
    .maybeSingle();
  return (data as StudentContact | null) ?? null;
}

function renderTemplate(template: string | undefined, fallback: string, context: Record<string, unknown>): string {
  const base = template?.trim() || fallback;
  return base.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = context[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

const DEFAULT_MESSAGE: Record<string, string> = {
  payment_received: "Payment of {amount} received. Thank you.",
  student_absent: "Your child was marked absent today.",
  attendance_recorded: "Attendance has been recorded.",
  student_promoted: "Your child has been promoted to the next class.",
  exam_submitted: "An exam has been submitted.",
  new_student_enrolled: "A new student has been enrolled.",
  fee_overdue: "An outstanding balance of {balance} is due on your child's account.",
  balance_threshold: "Your child's account balance is {balance}.",
  scheduled_daily: "Daily automation digest.",
};

/** Runs every DUE trigger row and records the outcome. Shared by the cron GET and the admin-triggered POST. */
async function runDueTriggers(
  svc: NonNullable<Awaited<ReturnType<typeof serviceClient>>>,
  scopedToOrgId?: string
): Promise<{ processed: number; succeeded: number; failed: number }> {
  const { data: due, error: dueErr } = await svc.rpc("get_due_automation_triggers");
  if (dueErr) throw new Error(`get_due_automation_triggers failed: ${dueErr.message}`);

  const rows = ((due ?? []) as DueTrigger[]).filter((r) => !scopedToOrgId || r.organization_id === scopedToOrgId);

  let succeeded = 0;
  let failed = 0;

  for (const row of rows) {
    const started = Date.now();
    const executed: { type: string; ok: boolean; reason?: string }[] = [];
    let contact: StudentContact | null = null;
    let contactResolved = false;

    for (const action of row.actions ?? []) {
      try {
        switch (action.type) {
          case "send_sms":
          case "send_email": {
            if (!contactResolved) {
              contact = await resolveStudentContact(svc, row.context.student_id as string | undefined);
              contactResolved = true;
            }
            const target = action.type === "send_sms" ? contact?.guardian_phone : contact?.guardian_email;
            if (!target) {
              executed.push({ type: action.type, ok: false, reason: "no student in this trigger's context, or no guardian contact on file" });
              break;
            }
            const message = renderTemplate(action.message ?? action.template, DEFAULT_MESSAGE[row.trigger_event] ?? "Automated notification.", row.context);
            const result = action.type === "send_sms"
              ? await sendSms(row.organization_id, [target], message)
              : await sendEmail(row.organization_id, [target], action.title ?? row.rule_name, message);
            executed.push({ type: action.type, ok: result.ok, reason: result.error });
            break;
          }

          case "send_announcement": {
            const { error } = await svc.rpc("broadcast_announcement_to_inbox", {
              p_title: action.title ?? row.rule_name,
              p_body: renderTemplate(action.body ?? action.message, DEFAULT_MESSAGE[row.trigger_event] ?? "Automated notification.", row.context),
              p_scope: "parents",
              p_class_id: null,
            });
            executed.push({ type: action.type, ok: !error, reason: error?.message });
            break;
          }

          case "log_activity":
          case "create_notification": {
            const { error } = await svc.from("activity_log").insert({
              action: action.type === "create_notification" ? "Automation Notification" : "Automation",
              details: `${row.rule_name}: ${renderTemplate(action.body ?? action.message, DEFAULT_MESSAGE[row.trigger_event] ?? "", row.context)}`,
              organization_id: row.organization_id,
            });
            executed.push({ type: action.type, ok: !error, reason: error?.message });
            break;
          }

          default:
            executed.push({ type: action.type, ok: false, reason: `unknown action type "${action.type}"` });
        }
      } catch (e) {
        executed.push({ type: action.type, ok: false, reason: e instanceof Error ? e.message : String(e) });
      }
    }

    const allOk = executed.every((e) => e.ok);
    const anyOk = executed.some((e) => e.ok);
    const status = executed.length === 0 ? "skipped" : allOk ? "success" : anyOk ? "partial" : "failed";
    if (status === "success") succeeded++; else failed++;

    await svc.rpc("record_automation_execution", {
      p_rule_id: row.rule_id,
      p_status: status,
      p_trigger_data: row.context,
      p_actions_executed: executed,
      p_error_message: executed.filter((e) => !e.ok).map((e) => `${e.type}: ${e.reason ?? "failed"}`).join("; ") || null,
      p_execution_time_ms: Date.now() - started,
    });
  }

  return { processed: rows.length, succeeded, failed };
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET is not configured on the server." }, { status: 500 });
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = await serviceClient();
  if (!svc) {
    return NextResponse.json({ error: "Server is missing its service-role configuration." }, { status: 500 });
  }

  try {
    const result = await runDueTriggers(svc);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    await logError({ source: "cron-automations", severity: "error", message: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Automation run failed." }, { status: 500 });
  }
}

/** "Run now" -- an org admin manually triggers their own org's due rules immediately. */
export async function POST(request: Request) {
  const guard = await requireStaffSession();
  if (guard) return guard;

  const supabase = await createClient();
  let body: { organizationId?: string };
  try {
    body = (await request.json()) as { organizationId?: string };
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  if (!body.organizationId) {
    return NextResponse.json({ error: "organizationId is required." }, { status: 400 });
  }

  const { data: isAdmin, error: adminErr } = await supabase.rpc("_is_org_admin_for", { p_org: body.organizationId });
  if (adminErr || !isAdmin) {
    return NextResponse.json({ error: "Not authorized for this school." }, { status: 403 });
  }

  const svc = await serviceClient();
  if (!svc) {
    return NextResponse.json({ error: "Server is missing its service-role configuration." }, { status: 500 });
  }

  try {
    const result = await runDueTriggers(svc, body.organizationId);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    await logError({ source: "cron-automations-manual", severity: "error", message: e instanceof Error ? e.message : String(e), organizationId: body.organizationId });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Automation run failed." }, { status: 500 });
  }
}
