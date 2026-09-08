/**
 * GET /api/attendance/subjects
 *
 * Returns subjects the caller is authorized to take subject-level attendance for,
 * filtered by the requested class_id.
 *
 * Query params:
 *   class_id  uuid  required
 *
 * Auth (mirrors reports/insights pattern):
 *   1. auth.getUser() → 401
 *   2. current_user_org_id() → 403  (is_platform_admin() → use class org)
 *   3. phase1_active_role() → teacher: must be assigned to class; admin/super_admin: all
 *
 * Phase 8.1 enforcement:
 *   4. subject_attendance_enabled → 403 when disabled
 *
 * Response:
 *   { subjects: [{ id, name, short_code }] }
 *   Subjects are active, belong to the resolved org, and — for teachers — match
 *   their teacher_assignments.subject_id (NULL = class-teacher, sees all subjects).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const HR_ACCESS_ROLES = new Set(["admin", "owner", "principal", "hr_manager", "hr", "super_admin"]);

interface ACSConfig {
  subject_attendance_enabled: boolean;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const class_id = searchParams.get("class_id") ?? "";

  if (!class_id) {
    return NextResponse.json({ error: "missing required param: class_id" }, { status: 400 });
  }

  const supabase = await createClient();

  // 1. Auth
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2. Org
  const { data: orgId, error: orgErr } = await supabase.rpc("current_user_org_id");
  if (orgErr || !orgId) {
    return NextResponse.json({ error: "organization not found" }, { status: 403 });
  }

  // 3. Platform admin: resolve effective org from class
  const { data: isPlatformAdmin } = await supabase.rpc("is_platform_admin");
  let effectiveOrgId: string = orgId as string;
  if (isPlatformAdmin) {
    const { data: classRow } = await supabase
      .from("classes")
      .select("organization_id")
      .eq("id", class_id)
      .single();
    if (!classRow) {
      return NextResponse.json({ error: "class not found" }, { status: 403 });
    }
    effectiveOrgId = (classRow as { organization_id: string }).organization_id;
  }

  // 4. Phase 8.1 — check subject_attendance_enabled for the resolved org
  const { data: cfgData } = await supabase.rpc("get_my_attendance_capture_settings");
  const cfgRow = (Array.isArray(cfgData) ? cfgData[0] : cfgData) as ACSConfig | null;
  const subjectAttendanceEnabled = cfgRow?.subject_attendance_enabled ?? true;

  if (!subjectAttendanceEnabled) {
    return NextResponse.json({ error: "subject-level attendance is disabled for this organisation" }, { status: 403 });
  }

  // 5. Role
  const { data: roleData } = await supabase.rpc("phase1_active_role");
  const activeRole = (roleData as string | null) ?? "";

  if (!HR_ACCESS_ROLES.has(activeRole) && activeRole !== "teacher") {
    return NextResponse.json({ error: "not authorized" }, { status: 403 });
  }

  // 6. Teacher: must be assigned to this class
  if (activeRole === "teacher") {
    const { data: assignments } = await supabase
      .from("teacher_assignments")
      .select("class_id, subject_id")
      .eq("user_id", user.id)
      .eq("organization_id", effectiveOrgId)
      .eq("class_id", class_id)
      .eq("active", true);

    if (!assignments || assignments.length === 0) {
      return NextResponse.json({ error: "not authorized for this class" }, { status: 403 });
    }

    type AssignmentRow = { class_id: string; subject_id: string | null };
    const rows = assignments as AssignmentRow[];
    const isClassTeacher = rows.some(r => r.subject_id === null);

    let subjectsQuery = supabase
      .from("subjects")
      .select("id, name, short_code")
      .eq("organization_id", effectiveOrgId)
      .eq("active", true)
      .order("name");

    if (!isClassTeacher) {
      // Subject teacher: only their assigned subjects for this class
      const subjectIds = rows.map(r => r.subject_id).filter(Boolean) as string[];
      subjectsQuery = subjectsQuery.in("id", subjectIds);
    }

    const { data: subjects } = await subjectsQuery;
    return NextResponse.json({ subjects: subjects ?? [] });
  }

  // 7. Admin / super_admin: all active subjects in the org
  const { data: subjects } = await supabase
    .from("subjects")
    .select("id, name, short_code")
    .eq("organization_id", effectiveOrgId)
    .eq("active", true)
    .order("name");

  return NextResponse.json({ subjects: subjects ?? [] });
}
