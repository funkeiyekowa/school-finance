/**
 * POST /api/proctoring/upload-url
 *
 * Issues a signed upload URL for a proctoring recording chunk, letting the
 * browser upload directly to Supabase Storage (not through this Vercel
 * function). This avoids the 4.5MB Vercel body limit and keeps the upload
 * fast/parallel.
 *
 * Only the student who owns the in-progress attempt can get a URL.
 * The path structure: proctoring-recordings/{attemptId}/{type}_{chunk}.webm
 */

import { NextResponse } from "next/server";
import { requireActiveSession } from "@/lib/api/requireSession";
import { rateLimitAsync, callerKey } from "@/lib/api/rateLimit";
import { createClient } from "@/lib/supabase/server";

const BUCKET = "proctoring-recordings";
const MAX_CHUNK_BYTES = 10 * 1024 * 1024;
const ALLOWED_RECORDING_TYPES = new Set(["video/webm", "video/mp4", "video/ogg"]);

interface Body {
  attemptId?: string;
  recordingType?: string;  // 'camera' | 'screen'
  chunkIndex?: number;
  contentType?: string;
  chunkSize?: number;
}

export async function POST(request: Request) {
  const session = await requireActiveSession();
  if (session instanceof Response) return session;

  const ipLimit = await rateLimitAsync({ name: "proctoring-upload-url", key: callerKey(request), max: 120, windowMs: 60_000 });
  const userLimit = await rateLimitAsync({ name: "proctoring-upload-url", key: `user:${session.user.id}`, max: 120, windowMs: 60_000 });
  const effectiveLimit = ipLimit.allowed ? userLimit : ipLimit;
  if (!effectiveLimit.allowed) {
    return NextResponse.json(
      { error: "Too many recording chunks. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(effectiveLimit.retryAfterMs / 1000)) } },
    );
  }

  let body: Body;
  try { body = (await request.json()) as Body; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { attemptId, recordingType, chunkIndex, contentType, chunkSize } = body;
  if (!attemptId || !recordingType || chunkIndex == null) {
    return NextResponse.json({ error: "Missing attemptId, recordingType, or chunkIndex" }, { status: 400 });
  }
  if (!["camera", "screen"].includes(recordingType)) {
    return NextResponse.json({ error: "recordingType must be camera or screen" }, { status: 400 });
  }
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex > 1_000_000) {
    return NextResponse.json({ error: "chunkIndex is invalid" }, { status: 400 });
  }
  const normalizedType = (contentType || "video/webm").split(";", 1)[0].trim().toLowerCase();
  if (!ALLOWED_RECORDING_TYPES.has(normalizedType)) {
    return NextResponse.json({ error: "Only WebM, MP4, or OGG recordings are supported" }, { status: 400 });
  }
  if (!Number.isInteger(chunkSize) || chunkSize <= 0 || chunkSize > MAX_CHUNK_BYTES) {
    return NextResponse.json({ error: "Recording chunk is too large or missing its size" }, { status: 400 });
  }

  // Verify the caller owns this in-progress attempt
  const supabase = await createClient();
  const { data: attempt } = await supabase
    .from("exam_attempts")
    .select("id, exam_id, student_id, status, organization_id")
    .eq("id", attemptId)
    .eq("organization_id", session.organizationId)
    .maybeSingle();

  if (!attempt) {
    return NextResponse.json({ error: "Attempt not found" }, { status: 404 });
  }

  // Check ownership: student's profile_id must match the session user
  const { data: student } = await supabase
    .from("students")
    .select("id")
    .eq("id", attempt.student_id)
    .eq("profile_id", session.user.id)
    .maybeSingle();

  if (!student) {
    return NextResponse.json({ error: "Not your attempt" }, { status: 403 });
  }

  if (attempt.status !== "in_progress") {
    return NextResponse.json({ error: "Attempt is no longer active" }, { status: 403 });
  }

  // Generate the storage path and a signed upload URL using the service role
  const ext = normalizedType === "video/mp4" ? "mp4" : normalizedType === "video/ogg" ? "ogg" : "webm";
  const storagePath = `${attemptId}/${recordingType}_${String(chunkIndex).padStart(5, "0")}.${ext}`;

  const svcUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!svcUrl || !svcKey) {
    return NextResponse.json({ error: "Server configuration missing" }, { status: 500 });
  }

  const { createClient: svcClient } = await import("@supabase/supabase-js");
  const svc = svcClient(svcUrl, svcKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: signedUrl, error: signErr } = await svc.storage
    .from(BUCKET)
    .createSignedUploadUrl(storagePath);

  if (signErr || !signedUrl) {
    return NextResponse.json(
      { error: signErr?.message || "Could not create upload URL" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    signedUrl: signedUrl.signedUrl,
    token: signedUrl.token,
    path: signedUrl.path,
    storagePath,
  });
}
