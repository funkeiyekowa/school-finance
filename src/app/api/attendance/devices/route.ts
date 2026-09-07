/**
 * POST /api/attendance/devices
 *
 * Register a new attendance capture device.
 * Only organization admins (owner/admin/super_admin) may call this.
 *
 * Request body (JSON):
 *   {
 *     device_type: "qr" | "rfid",
 *     class_id: "uuid",
 *     label?: "string"
 *   }
 *
 * Response 201:
 *   {
 *     id, device_type, class_id, label, active, created_at,
 *     token: "<64-char hex — shown exactly once, never retrievable again>"
 *   }
 *
 * Security:
 *   - org_id is derived server-side from the authenticated session only.
 *   - Token plaintext is generated here and never logged or stored.
 *   - Only the SHA-256 hash of the token is written to the database.
 *   - token_hash is never returned in the response.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomBytes, createHash } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

const ADMIN_ROLES = new Set(["owner", "admin", "super_admin"]);
const VALID_DEVICE_TYPES = ["qr", "rfid"] as const;
type DeviceType = (typeof VALID_DEVICE_TYPES)[number];

function makeServiceSupa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Service role env vars missing");
  return createServiceClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
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

  // 2. Require admin role — device management is admin-only.
  if (!ADMIN_ROLES.has(membership.role)) {
    return NextResponse.json(
      { error: "Only organization admins can manage devices." },
      { status: 403 },
    );
  }

  const orgId = membership.organization_id;

  // 3. Parse and validate body.
  let body: { device_type?: unknown; class_id?: unknown; label?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { device_type, class_id, label } = body;

  if (!VALID_DEVICE_TYPES.includes(device_type as DeviceType)) {
    return NextResponse.json(
      { error: `device_type must be one of: ${VALID_DEVICE_TYPES.join(", ")}` },
      { status: 400 },
    );
  }
  if (typeof class_id !== "string" || !class_id) {
    return NextResponse.json({ error: "class_id is required." }, { status: 400 });
  }
  if (label !== undefined && label !== null && typeof label !== "string") {
    return NextResponse.json(
      { error: "label must be a string or null." },
      { status: 400 },
    );
  }

  // 4. Verify the class belongs to the caller's org (defence in depth).
  const { data: classRow } = await supabase
    .from("classes")
    .select("id")
    .eq("id", class_id)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!classRow) {
    return NextResponse.json(
      { error: "Class not found in your organization." },
      { status: 422 },
    );
  }

  // 5. Generate token server-side — plaintext shown once, hash stored.
  const rawToken = randomBytes(32).toString("hex"); // 256-bit
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");

  // 6. Insert via service-role client (authorization enforced above).
  let svc;
  try {
    svc = makeServiceSupa();
  } catch {
    return NextResponse.json(
      { error: "Server configuration error." },
      { status: 500 },
    );
  }

  const { data: device, error: insertError } = await svc
    .from("attendance_capture_devices")
    .insert({
      org_id: orgId,
      class_id,
      device_type: device_type as DeviceType,
      label: (label as string | null) ?? null,
      token_hash: tokenHash,
      active: true,
    })
    .select("id, device_type, class_id, label, active, created_at")
    .single();

  if (insertError || !device) {
    return NextResponse.json(
      { error: insertError?.message ?? "Failed to register device." },
      { status: 500 },
    );
  }

  // 7. Return device row + plaintext token. token_hash is NEVER returned.
  return NextResponse.json({ ...device, token: rawToken }, { status: 201 });
}
