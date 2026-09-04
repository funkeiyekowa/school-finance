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
import { createClient } from "@/lib/supabase/server";

const BUCKET = "proctoring-recordings";

interface Body {
  attemptId?: string;
  recordingType?: string;  // 'camera' | 'screen'
  chunkIndex?: number;
  contentType?: string;
}

export async function POST(request: Request) {
  const session = await requireActiveSession();
  if (session instanceof Response) return session;

  let body: Body;
  try { body = (await request.json()) as Body; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { attemptId, recordingType, chunkIndex, contentType } = body;
  if (!attemptId || !recordingType || chunkIndex == null) {
    return NextResponse.json({ error: "Missing attemptId, recordingType, or chunkIndex" }, { status: 400 });
  }
  if (!["camera", "screen"].includes(recordingType)) {
    return NextResponse.json({ error: "recordingType must be camera or screen" }, { status: 400 });
  }

  // Verify the caller owns this in-progress attempt
  const supabase = await createClient();
  const { data: attempt } = await supabase
    .from("exam_attempts")
    .select("id, exam_id, student_id, status, organization_id")
    .eq("id", attemptId)
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
  const ext = (contentType ?? "video/webm").includes("jpeg") || (contentType ?? "").includes("png") ? "jpg" : "webm";
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
