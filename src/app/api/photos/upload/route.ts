import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/alerts/service";
import { rateLimit, callerKey } from "@/lib/api/rateLimit";
import { logError, requestContext } from "@/lib/errors/logError";

/**
 * Server-mediated profile photo upload.
 *
 * Why this route exists: direct browser -> Supabase Storage uploads
 * (supabase.storage.from("profile-photos").upload(...)) started failing
 * for every role with a 503 "DatabaseInvalidObjectDefinition" /
 * "The database schema is invalid or incompatible." straight from
 * Supabase's own Storage API, before our RLS policies are even
 * evaluated -- confirmed via the browser's Network tab, and ruled out
 * as anything on our side (bucket, storage.migrations, storage.objects
 * columns and our four profile_photos_* policies all check out fine
 * directly in SQL). That failure lives in the authenticated Storage
 * REST path itself; a service-role upload from our own server hits
 * Storage the same way SUPABASE_SERVICE_ROLE_KEY-based routes already
 * do elsewhere in this codebase (see src/lib/alerts/service.ts), which
 * this route reuses.
 *
 * This does NOT weaken tenant isolation: the caller's session (read via
 * the cookie-based server client, never trusted as-is) is used to look
 * up their org membership and -- for a student/parent -- their linked
 * entity, entirely server-side, before the service-role client ever
 * touches Storage. The storage path is always built here, never taken
 * from the client, so nobody can write into another org's folder.
 */

const UPLOAD_RATE_MAX = 20;
const UPLOAD_RATE_WINDOW_MS = 60_000;

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);
const MAX_BYTES = 5 * 1024 * 1024; // 5MB — well above compressImage()'s client-side output.

const STAFF_ROLES = new Set([
  "owner", "admin", "editor", "staff", "bursar", "accountant",
  "teacher", "developer", "super_admin",
]);

type Kind = "staff" | "students";

export async function POST(request: Request) {
  const ip = callerKey(request);
  const rl = rateLimit({ name: "photos-upload", key: ip, max: UPLOAD_RATE_MAX, windowMs: UPLOAD_RATE_WINDOW_MS });
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
  const role = (membership as { role?: string } | null)?.role;
  if (!orgId || !role) {
    return NextResponse.json({ error: "No active organization for this account." }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const file = form.get("file");
  const kind = form.get("kind");
  const entityId = form.get("entityId");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (kind !== "staff" && kind !== "students") {
    return NextResponse.json({ error: "Invalid upload kind." }, { status: 400 });
  }
  if (typeof entityId !== "string" || !entityId) {
    return NextResponse.json({ error: "Missing entityId." }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Please upload a JPEG, PNG, WEBP or HEIC image." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Image is too large (max 5MB)." }, { status: 400 });
  }

  // Authorize: who is allowed to upload a photo for this specific entity?
  const authError = await authorizeTarget(supabase, { userId: user.id, orgId, role, kind, entityId });
  if (authError) return authError;

  const svc = createServiceClient();
  const ext = extensionFor(file.type);
  const path = `${orgId}/${kind}/${entityId}/${crypto.randomUUID()}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error: uploadError } = await svc.storage.from("profile-photos").upload(path, bytes, {
    contentType: file.type,
    upsert: false,
  });

  if (uploadError) {
    await logError({
      source: "photos-upload",
      severity: "error",
      message: `Storage upload failed: ${uploadError.message}`,
      context: { orgId, kind, entityId, path },
      ...requestContext(request),
    });
    return NextResponse.json(
      { error: "Photo upload failed. Please try again in a moment." },
      { status: 502 },
    );
  }

  const { data } = svc.storage.from("profile-photos").getPublicUrl(path);
  return NextResponse.json({ url: data.publicUrl, path });
}

function extensionFor(mime: string): string {
  switch (mime) {
    case "image/png": return "png";
    case "image/webp": return "webp";
    case "image/heic": return "heic";
    default: return "jpg";
  }
}

/**
 * Mirrors the authorization the old RLS write policy plus each RPC's own
 * checks used to enforce, now done server-side before Storage is touched:
 *   - staff: may only upload for their own staff_members row.
 *   - students: may upload for themselves (self, pending review), for a
 *     linked child (parent), or for any student in-org (staff/admin,
 *     e.g. bulk photo day).
 */
async function authorizeTarget(
  supabase: Awaited<ReturnType<typeof createClient>>,
  opts: { userId: string; orgId: string; role: string; kind: Kind; entityId: string },
): Promise<Response | null> {
  const { userId, orgId, role, kind, entityId } = opts;
  const isStaffRole = STAFF_ROLES.has(role);

  if (kind === "staff") {
    if (isStaffRole) {
      // Staff/admin uploading — self or (if privileged) another staff
      // member in the same org; both cases must resolve to an in-org row.
      const { data: staffRow } = await supabase
        .from("staff_members")
        .select("id")
        .eq("id", entityId)
        .eq("organization_id", orgId)
        .maybeSingle();
      if (!staffRow) return NextResponse.json({ error: "Staff record not found in your organization." }, { status: 403 });
      return null;
    }
    return NextResponse.json({ error: "Not authorized to upload a staff photo." }, { status: 403 });
  }

  // kind === "students"
  if (isStaffRole) {
    const { data: studentRow } = await supabase
      .from("students")
      .select("id")
      .eq("id", entityId)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!studentRow) return NextResponse.json({ error: "Student record not found in your organization." }, { status: 403 });
    return null;
  }

  if (role === "student") {
    const { data: ownRow } = await supabase
      .from("students")
      .select("id")
      .eq("id", entityId)
      .eq("organization_id", orgId)
      .eq("profile_id", userId)
      .maybeSingle();
    if (!ownRow) return NextResponse.json({ error: "You can only upload your own photo." }, { status: 403 });
    return null;
  }

  if (role === "parent") {
    // Canonical link chain (matches My Children / parents CRUD / RLS):
    // auth.users.id -> parent_profiles.profile_id -> parent_student_links.parent_id -> students.id
    const { data: pp } = await supabase
      .from("parent_profiles")
      .select("id")
      .eq("profile_id", userId)
      .maybeSingle();
    const parentId = (pp as { id?: string } | null)?.id;
    if (!parentId) return NextResponse.json({ error: "No parent record linked to your login." }, { status: 403 });

    const { data: link } = await supabase
      .from("parent_student_links")
      .select("student_id")
      .eq("parent_id", parentId)
      .eq("student_id", entityId)
      .maybeSingle();
    if (!link) return NextResponse.json({ error: "You can only upload a photo for your own child." }, { status: 403 });
    return null;
  }

  return NextResponse.json({ error: "Not authorized." }, { status: 403 });
}
