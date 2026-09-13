/**
 * POST /api/notifications/push-event
 *
 * Server-side push delivery for non-message events: attendance marked,
 * exam published. Mirrors /api/notifications/push exactly, with one
 * difference: this route is only ever called from the web staff
 * dashboard (attendance/page.tsx, cbt/page.tsx) right after an existing
 * successful action, so auth is cookie-based via requireStaffSessionWithOrg()
 * rather than the Bearer-token path that route needs for mobile callers.
 *
 * Auth chain:
 *   1. requireStaffSessionWithOrg() — caller must be a signed-in staff
 *      member (not student/parent) with an active default org.
 *   2. The row being acted on (attendance_records for that class/date/
 *      session, or the exams row) must belong to the caller's own
 *      organization_id — resolved server-side, never trusted from the
 *      request body beyond the id used to look it up. This prevents a
 *      staff member from one org triggering notifications tied to
 *      another org's data.
 *   3. Only then does the service client resolve recipients via
 *      push_targets_for_attendance() / push_targets_for_exam(), both
 *      granted to service_role ONLY (see 20260916000001 migration).
 *
 * The service-role key is read from the server environment and never
 * leaves it. Delivery is always best-effort: a failure here must never
 * fail the attendance save or exam publish it follows.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireStaffSessionWithOrg } from "@/lib/api/requireStaff";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const CHUNK = 100;

interface PushTarget {
  user_id: string;
  expo_push_token: string;
  title: string;
  body: string;
  student_id: string;
}

interface ExpoTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

type EventBody =
  | { event: "attendance"; classId: string; date: string; session: string; subjectId?: string | null }
  | { event: "exam"; examId: string };

// Minimal shape used from the service client: only .rpc() is called here.
// PostgrestFilterBuilder (the real return type of supabase-js's .rpc()) is
// thenable but not a structural Promise, so the signature awaits it via a
// plain function type rather than requiring Promise<...> compatibility.
interface ServiceRpcClient {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
}

async function sendExpoBatch(
  targets: PushTarget[],
  channelId: string,
  extraData: Record<string, unknown>,
  svc: ServiceRpcClient,
): Promise<{ sent: number; invalidated: number }> {
  const messages = targets.map((t) => ({
    to: t.expo_push_token,
    title: t.title,
    body: t.body,
    sound: "default" as const,
    channelId,
    data: { ...extraData, studentId: t.student_id },
  }));

  const invalidTokens: string[] = [];
  let sent = 0;

  for (let i = 0; i < messages.length; i += CHUNK) {
    const batch = messages.slice(i, i + CHUNK);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(batch),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { data?: ExpoTicket[] };
      const tickets = json.data ?? [];
      tickets.forEach((ticket, idx) => {
        if (ticket.status === "ok") {
          sent += 1;
          return;
        }
        if (ticket.details?.error === "DeviceNotRegistered") {
          const dead = batch[idx]?.to;
          if (dead) invalidTokens.push(dead);
        }
      });
    } catch {
      // A transient Expo outage must not fail the caller's action.
      continue;
    }
  }

  if (invalidTokens.length > 0) {
    await svc.rpc("mark_push_tokens_invalid", { p_tokens: invalidTokens }).then(
      () => {},
      () => {},
    );
  }

  return { sent, invalidated: invalidTokens.length };
}

export async function POST(req: NextRequest): Promise<Response> {
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!svcKey || !url) {
    return NextResponse.json({ error: "push not configured" }, { status: 503 });
  }

  const { guard, organizationId } = await requireStaffSessionWithOrg();
  if (guard) return guard;

  let body: EventBody;
  try {
    body = (await req.json()) as EventBody;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { createClient: createServiceClient } = await import("@supabase/supabase-js");
  const svc = createServiceClient(url, svcKey, { auth: { persistSession: false } });

  if (body.event === "attendance") {
    const { classId, date, session, subjectId } = body;
    if (!classId || !date || !session) {
      return NextResponse.json({ error: "missing classId/date/session" }, { status: 400 });
    }

    // The class being acted on must belong to the caller's own org.
    const { data: classRow } = await svc
      .from("classes")
      .select("id, organization_id")
      .eq("id", classId)
      .maybeSingle();
    if (!classRow || (classRow as { organization_id: string }).organization_id !== organizationId) {
      return NextResponse.json({ error: "not authorized for this class" }, { status: 403 });
    }

    const { data: targetRows, error: targetErr } = await svc.rpc("push_targets_for_attendance", {
      p_class_id: classId,
      p_date: date,
      p_session: session,
      p_subject_id: subjectId ?? null,
    });
    if (targetErr) {
      return NextResponse.json({ error: "could not resolve recipients" }, { status: 500 });
    }
    const targets = (targetRows as PushTarget[]) ?? [];
    if (targets.length === 0) return NextResponse.json({ ok: true, sent: 0 });

    const result = await sendExpoBatch(targets, "attendance", { type: "attendance", classId, date }, svc);
    return NextResponse.json({ ok: true, ...result });
  }

  if (body.event === "exam") {
    const { examId } = body;
    if (!examId) {
      return NextResponse.json({ error: "missing examId" }, { status: 400 });
    }

    // The exam being acted on must belong to the caller's own org.
    const { data: examRow } = await svc
      .from("exams")
      .select("id, organization_id, status")
      .eq("id", examId)
      .maybeSingle();
    if (!examRow || (examRow as { organization_id: string }).organization_id !== organizationId) {
      return NextResponse.json({ error: "not authorized for this exam" }, { status: 403 });
    }
    if ((examRow as { status: string }).status !== "published") {
      return NextResponse.json({ ok: true, sent: 0, reason: "exam not published" });
    }

    const { data: targetRows, error: targetErr } = await svc.rpc("push_targets_for_exam", {
      p_exam_id: examId,
    });
    if (targetErr) {
      return NextResponse.json({ error: "could not resolve recipients" }, { status: 500 });
    }
    const targets = (targetRows as PushTarget[]) ?? [];
    if (targets.length === 0) return NextResponse.json({ ok: true, sent: 0 });

    const result = await sendExpoBatch(targets, "exams", { type: "exam", examId }, svc);
    return NextResponse.json({ ok: true, ...result });
  }

  return NextResponse.json({ error: "unknown event" }, { status: 400 });
}
