/**
 * POST /api/attendance/ingest
 *
 * Server-side ingest endpoint for QR/RFID hardware devices.
 * Devices authenticate with a Bearer token (generated at registration).
 * The token is hashed server-side with SHA-256; only the hash is ever
 * sent to the database.
 *
 * Request body (JSON):
 *   {
 *     date:    "YYYY-MM-DD",
 *     session: "full_day" | "morning" | "afternoon",
 *     marks:   [{ student_id: "uuid", status_code: "text", remarks?: "text" }, ...]
 *   }
 *
 * Response:
 *   200  { success: true, count: N }
 *   400  { error: "missing required fields: …" }
 *   401  { error: "missing or invalid device token" }
 *   403  { error: "device not authorized for this operation" }
 *   422  { error: "<validation message from DB>" }
 *   500  { error: "internal error" }
 *
 * Authorization is enforced inside ingest_attendance_from_device():
 *   - Token hash lookup → device row (org, class, device_type)
 *   - Class belongs to device's org
 *   - Every submitted student belongs to device's org
 *   - Every status_code is valid for device's org
 *   - Atomic DELETE (subject_id IS NULL) + INSERT
 *
 * RATE LIMITING: none implemented in Phase 2. A compromised device
 * token could be used for rapid replay. Add Upstash/Redis rate
 * limiting before production scale if required.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

// Service-role client — bypasses RLS so it can call
// ingest_attendance_from_device() which is NOT granted to 'authenticated'.
function makeServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role env vars missing");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Map known DB exception messages to HTTP status codes.
function httpStatusForDbError(message: string): number {
  if (message.includes("invalid or inactive device")) return 401;
  if (message.includes("not authorized") || message.includes("not assigned")) return 403;
  if (
    message.includes("not found in") ||
    message.includes("not valid for") ||
    message.includes("marks array is empty") ||
    message.includes("must have student_id") ||
    message.includes("not enrolled in device class")
  )
    return 422;
  return 500;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Extract and validate Bearer token.
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

  // 2. Hash the token — the plaintext never reaches the database.
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");

  // 3. Parse and validate body.
  let body: { date?: unknown; session?: unknown; marks?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { date, session, marks } = body;
  if (
    typeof date !== "string" ||
    typeof session !== "string" ||
    !Array.isArray(marks) ||
    marks.length === 0
  ) {
    return NextResponse.json(
      { error: "missing required fields: date (string), session (string), marks (non-empty array)" },
      { status: 400 }
    );
  }

  // 4. Call DB function — it validates the token, class, students, and
  //    performs the atomic replace. capture_method is set from the
  //    device row's device_type inside the function.
  let svc;
  try {
    svc = makeServiceClient();
  } catch (e) {
    console.error("[ingest] service client init failed:", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }

  const { data, error } = await svc.rpc("ingest_attendance_from_device", {
    p_token_hash: tokenHash,
    p_date: date,
    p_session: session,
    p_marks: marks,
  });

  if (error) {
    console.warn("[ingest] DB error:", error.message);
    return NextResponse.json(
      { error: error.message },
      { status: httpStatusForDbError(error.message) }
    );
  }

  return NextResponse.json(data);
}
