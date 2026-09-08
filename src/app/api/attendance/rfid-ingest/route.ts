/**
 * POST /api/attendance/rfid-ingest
 *
 * RFID/NFC attendance ingest endpoint.
 *
 * Auth model: same Bearer device token as /api/attendance/ingest.
 * The token must belong to a device with device_type = 'rfid'.
 *
 * Request body (JSON):
 *   {
 *     card_uid:     string,   // raw UID from HID keyboard reader
 *     date:         "YYYY-MM-DD",
 *     session:      "full_day" | "morning" | "afternoon",
 *     status_code?: string    // defaults to "present"
 *   }
 *
 * Response:
 *   200  { success: true, student_name: string }
 *   400  { error: string }
 *   401  { error: string }
 *   403  { error: string }
 *   404  { error: "RFID card not recognised or inactive: <uid>" }
 *   422  { error: string }
 *   500  { error: string }
 *
 * Flow:
 *   1. Validate Bearer token (hash it — plaintext never stored).
 *   2. Lookup device row — must exist, be active, and be device_type='rfid'.
 *   3. Resolve card_uid → student_id via resolve_rfid_card(org_id, card_uid).
 *   4. Call ingest_attendance_from_device() with a single mark.
 *   5. Return { success: true, student_name }.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

function makeServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role env vars missing");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function httpStatusForDbError(message: string): number {
  if (message.includes("invalid or inactive device")) return 401;
  if (message.includes("not recognised or inactive")) return 404;
  if (message.includes("not authorized") || message.includes("not assigned")) return 403;
  if (
    message.includes("not found in") ||
    message.includes("not valid for") ||
    message.includes("must have student_id") ||
    message.includes("not enrolled in device class")
  )
    return 422;
  return 500;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Extract Bearer token
  const authHeader = req.headers.get("authorization") ?? "";
  const rawToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (!rawToken) {
    return NextResponse.json(
      { error: "missing or invalid device token" },
      { status: 401 }
    );
  }

  const tokenHash = createHash("sha256").update(rawToken).digest("hex");

  // 2. Parse body
  let body: { card_uid?: unknown; date?: unknown; session?: unknown; status_code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { card_uid, date, session, status_code = "present" } = body;

  if (
    typeof card_uid !== "string" || card_uid.trim().length < 4 ||
    typeof date !== "string" ||
    typeof session !== "string"
  ) {
    return NextResponse.json(
      { error: "missing required fields: card_uid (min 4 chars), date, session" },
      { status: 400 }
    );
  }

  const cleanUid = card_uid.trim().toUpperCase();

  let svc;
  try {
    svc = makeServiceClient();
  } catch (e) {
    console.error("[rfid-ingest] service client init failed:", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }

  // 3. Look up device by token hash — must be rfid type
  const { data: device, error: deviceErr } = await svc
    .from("attendance_capture_devices")
    .select("id, org_id, device_type, active")
    .eq("token_hash", tokenHash)
    .eq("active", true)
    .single();

  if (deviceErr || !device) {
    return NextResponse.json(
      { error: "invalid or inactive device token" },
      { status: 401 }
    );
  }

  if (device.device_type !== "rfid") {
    return NextResponse.json(
      { error: "this token belongs to a non-RFID device; use /api/attendance/ingest for QR devices" },
      { status: 403 }
    );
  }

  // 4. Resolve card UID → student_id
  const { data: studentId, error: resolveErr } = await svc.rpc("resolve_rfid_card", {
    p_org_id: device.org_id,
    p_card_uid: cleanUid,
  });

  if (resolveErr || !studentId) {
    const msg = resolveErr?.message ?? "RFID card not recognised or inactive";
    console.warn("[rfid-ingest] resolve failed:", msg);
    return NextResponse.json(
      { error: msg },
      { status: httpStatusForDbError(msg) }
    );
  }

  // 5. Fetch student name for the response (best-effort)
  const { data: studentRow } = await svc
    .from("students")
    .select("first_name, last_name")
    .eq("id", studentId)
    .single();

  const studentName = studentRow
    ? `${studentRow.first_name} ${studentRow.last_name}`
    : "Unknown Student";

  // 6. Ingest attendance via the shared device ingest RPC
  const { data: ingestData, error: ingestErr } = await svc.rpc(
    "ingest_attendance_from_device",
    {
      p_token_hash: tokenHash,
      p_date: date,
      p_session: session,
      p_marks: [{ student_id: studentId, status_code: String(status_code) }],
    }
  );

  if (ingestErr) {
    console.warn("[rfid-ingest] ingest error:", ingestErr.message);
    return NextResponse.json(
      { error: ingestErr.message },
      { status: httpStatusForDbError(ingestErr.message) }
    );
  }

  return NextResponse.json({
    success: true,
    student_name: studentName,
    ...(ingestData ?? {}),
  });
}
