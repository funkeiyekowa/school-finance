/**
 * PATCH /api/attendance/devices/[id]
 *
 * Update label and/or deactivate an attendance capture device.
 * Only organization admins (owner/admin/super_admin) may call this.
 *
 * Request body (JSON) — all fields optional:
 *   {
 *     label?: string | null,
 *     active?: false   // can only deactivate; cannot reactivate via API
 *   }
 *
 * Response 200:
 *   { id, device_type, class_id, label, active, created_at }
 *
 * Security:
 *   - Caller must be authenticated with admin role in their active org.
 *   - org_id is derived server-side; never accepted from request body.
 *   - The target device must belong to the caller's org before any mutation.
 *   - Deactivation sets active = false (soft delete); rows are never deleted.
 *   - token_hash is never returned.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

const ADMIN_ROLES = new Set(["owner", "admin", "super_admin"]);

function makeServiceSupa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Service role env vars missing");
  return createServiceClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: deviceId } = await params;

  // 1. Authenticate caller — resolve org from session, never from body.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: membership, error: membershipError } = await supabase
    .from("org_memberships")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .eq("active", true)
    .eq("is_default", true)
    .maybeSingle();

  if (membershipError || !membership?.organization_id || !membership?.role) {
    return NextResponse.json(
      { error: "No active organization membership." },
      { status: 403 },
    );
  }

  // 2. Require admin role.
  if (!ADMIN_ROLES.has(membership.role)) {
    return NextResponse.json(
      { error: "Only organization admins can manage devices." },
      { status: 403 },
    );
  }

  const orgId = membership.organization_id;

  // 3. Verify the target device belongs to this org BEFORE any mutation.
  const { data: existing } = await supabase
    .from("attendance_capture_devices")
    .select("id, org_id")
    .eq("id", deviceId)
    .maybeSingle();

  if (!existing || existing.org_id !== orgId) {
    return NextResponse.json(
      { error: "Device not found in your organization." },
      { status: 404 },
    );
  }

  // 4. Parse body.
  let body: { label?: unknown; active?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const update: Record<string, unknown> = {};

  if ("label" in body) {
    if (body.label !== null && typeof body.label !== "string") {
      return NextResponse.json(
        { error: "label must be a string or null." },
        { status: 400 },
      );
    }
    update.label = body.label ?? null;
  }

  if ("active" in body) {
    if (body.active !== false) {
      // Only deactivation is permitted via this API (active -> false).
      // Re-activation requires a deliberate admin SQL operation.
      return NextResponse.json(
        { error: "Only deactivation (active: false) is permitted via this endpoint." },
        { status: 400 },
      );
    }
    update.active = false;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: "No updatable fields provided (label, active)." },
      { status: 400 },
    );
  }

  // 5. Apply mutation via service-role (authorization enforced above).
  let svc;
  try {
    svc = makeServiceSupa();
  } catch {
    return NextResponse.json(
      { error: "Server configuration error." },
      { status: 500 },
    );
  }

  const { data: device, error: updateError } = await svc
    .from("attendance_capture_devices")
    .update(update)
    .eq("id", deviceId)
    .eq("org_id", orgId) // belt-and-suspenders org scope on the write
    .select("id, device_type, class_id, label, active, created_at")
    .single();

  if (updateError || !device) {
    return NextResponse.json(
      { error: updateError?.message ?? "Failed to update device." },
      { status: 500 },
    );
  }

  // token_hash is never included in the select or the response.
  return NextResponse.json(device);
}
