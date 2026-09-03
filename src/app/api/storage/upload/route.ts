import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/alerts/service";
import { rateLimit, callerKey } from "@/lib/api/rateLimit";
import { logError, requestContext } from "@/lib/errors/logError";

/**
 * Server-mediated storage upload for website media and message
 * attachments.
 *
 * Same root cause and fix as /api/photos/upload (see that route's doc
 * comment): direct browser -> Supabase Storage uploads started failing
 * with a 503 "DatabaseInvalidObjectDefinition" / "The database schema
 * is invalid or incompatible." straight from Supabase's own Storage
 * API, before our RLS policies are even evaluated. Confirmed on
 * profile-photos, then found (by grep) to be the same call shape in
 * two more places that were still uploading directly from the browser:
 * Website Studio's logo/media-library uploads (website-media bucket)
 * and message attachments (message-attachments bucket) -- proactively
 * fixed here before either got reported broken.
 *
 * This is a separate route from /api/photos/upload rather than a third
 * "kind" bolted on there, because the validation shape genuinely
 * differs: website-media accepts images + PDFs up to 10MB and is a
 * public bucket; message-attachments accepts a wider document allowlist
 * up to (a generous backstop over) the org's configured limit and is a
 * *private* bucket, so it returns the storage path only -- the caller
 * still calls getAttachmentSignedUrl() to display it, same as before.
 *
 * Authorization, done server-side before Storage is touched:
 *   - website-media: org admin only (matches Website Studio's
 *     client-side isOrgAdmin gate).
 *   - message-attachments: caller must be an active member of the
 *     target conversation (conversation_members, left_at IS NULL).
 */

const UPLOAD_RATE_MAX = 30;
const UPLOAD_RATE_WINDOW_MS = 60_000;

const ORG_ADMIN_ROLES = new Set(["owner", "admin", "super_admin"]);

const WEBSITE_MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml", "application/pdf"]);
const WEBSITE_MEDIA_MAX_BYTES = 10 * 1024 * 1024;

// Mirrors messaging_policy.allowed_attachment_types' default (see
// supabase/20260902180000_communication_module.sql) -- a server-side
// backstop, not a per-org policy re-implementation; an org's own
// (narrower) policy is still enforced client-side in Composer.tsx.
const MESSAGE_ATTACHMENT_TYPES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain", "text/csv",
]);
const MESSAGE_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request) {
  const ip = callerKey(request);
  const rl = rateLimit({ name: "storage-upload", key: ip, max: UPLOAD_RATE_MAX, windowMs: UPLOAD_RATE_WINDOW_MS });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many uploads — please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: membership } = await supabase
    .from("org_memberships")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .eq("active", true)
    .eq("is_default", true)
    .maybeSingle();

  const orgId = (membership as { organization_id?: string } | null)?.organization_id;
  const membershipRole = (membership as { role?: string } | null)?.role;
  if (!orgId || !membershipRole) {
    return NextResponse.json({ error: "No active organization for this account." }, { status: 403 });
  }

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("role, active")
    .eq("id", user.id)
    .maybeSingle();
  const isDeveloper = (profileRow as { role?: string; active?: boolean } | null)?.role === "developer"
    && ((profileRow as { active?: boolean } | null)?.active ?? false);
  const role = isDeveloper ? "super_admin" : membershipRole;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const file = form.get("file");
  const bucket = form.get("bucket");
  const conversationId = form.get("conversationId");
  const folder = form.get("folder"); // website-media only, optional

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (bucket !== "website-media" && bucket !== "message-attachments") {
    return NextResponse.json({ error: "Invalid upload bucket." }, { status: 400 });
  }

  if (bucket === "website-media") {
    if (!ORG_ADMIN_ROLES.has(role)) {
      return NextResponse.json({ error: "Only school administrators can manage website media." }, { status: 403 });
    }
    if (!WEBSITE_MEDIA_TYPES.has(file.type)) {
      return NextResponse.json({ error: "Please upload an image or PDF file." }, { status: 400 });
    }
    if (file.size > WEBSITE_MEDIA_MAX_BYTES) {
      return NextResponse.json({ error: "File must be under 10MB." }, { status: 400 });
    }
  } else {
    if (typeof conversationId !== "string" || !conversationId) {
      return NextResponse.json({ error: "Missing conversationId." }, { status: 400 });
    }
    const { data: memberRow } = await supabase
      .from("conversation_members")
      .select("user_id")
      .eq("conversation_id", conversationId)
      .eq("user_id", user.id)
      .is("left_at", null)
      .maybeSingle();
    if (!memberRow) {
      return NextResponse.json({ error: "You are not a member of this conversation." }, { status: 403 });
    }
    if (!MESSAGE_ATTACHMENT_TYPES.has(file.type)) {
      return NextResponse.json({ error: "That file type isn't supported as an attachment." }, { status: 400 });
    }
    if (file.size > MESSAGE_ATTACHMENT_MAX_BYTES) {
      return NextResponse.json({ error: "Attachment is too large (max 25MB)." }, { status: 400 });
    }
  }

  const svc = createServiceClient();
  const safeName = file.name.replace(/[^\w.-]+/g, "_");
  const path = bucket === "website-media"
    ? `${orgId}/${typeof folder === "string" && folder ? `${folder}/` : ""}${Date.now()}-${safeName}`
    : `${orgId}/${conversationId}/${crypto.randomUUID()}-${safeName}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error: uploadError } = await svc.storage.from(bucket).upload(path, bytes, {
    contentType: file.type || "application/octet-stream",
    cacheControl: bucket === "website-media" ? "31536000" : undefined,
    upsert: false,
  });

  if (uploadError) {
    await logError({
      source: "storage-upload",
      severity: "error",
      message: `Storage upload failed: ${uploadError.message}`,
      context: { orgId, bucket, path },
      ...requestContext(request),
    });
    return NextResponse.json(
      { error: "Upload failed. Please try again in a moment." },
      { status: 502 },
    );
  }

  if (bucket === "website-media") {
    const { data } = svc.storage.from(bucket).getPublicUrl(path);
    return NextResponse.json({ url: data.publicUrl, path });
  }

  // message-attachments is a private bucket -- no public URL; the
  // caller resolves display access via getAttachmentSignedUrl(path).
  return NextResponse.json({ path });
}
