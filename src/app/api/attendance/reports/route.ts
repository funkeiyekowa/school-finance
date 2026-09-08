/**
 * GET /api/attendance/reports
 *
 * Attendance summary report for a class × date range.
 *
 * Query params:
 *   class_id   uuid     required
 *   date_from  YYYY-MM-DD  required
 *   date_to    YYYY-MM-DD  required
 *   format     "json" | "csv"  optional, default "json"
 *
 * Auth (mirrors /api/attendance/insights):
 *   1. auth.getUser() → 401
 *   2. current_user_org_id() → 403
 *   3. phase1_active_role() → teacher: must be assigned to this class
 *      hr_access roles (admin/owner/hr/principal): all classes
 *   4. class must belong to caller's org → 403
 *
 * Response JSON:
 *   {
 *     class_name: string,
 *     date_from: string, date_to: string,
 *     students: [{ student_id, student_code, full_name }],
 *     dates: string[],   // sorted unique dates in range with records
 *     records: [{ student_id, date, session, status_code }],
 *     statuses: [{ code, label, counts_as_present }]
 *   }
 *
 * Response CSV (format=csv):
 *   Student Code, Student Name, Date, Session, Status
 *   (no internal UUIDs exposed)
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const HR_ACCESS_ROLES = new Set(["admin", "owner", "principal", "hr_manager", "hr"]);

async function makeSupabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => cookieStore.get(name)?.value,
      },
    }
  );
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const class_id = searchParams.get("class_id") ?? "";
  const date_from = searchParams.get("date_from") ?? "";
  const date_to = searchParams.get("date_to") ?? "";
  const format = searchParams.get("format") ?? "json";

  if (!class_id || !date_from || !date_to) {
    return NextResponse.json(
      { error: "missing required params: class_id, date_from, date_to" },
      { status: 400 }
    );
  }

  // Basic date format validation
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date_from) || !/^\d{4}-\d{2}-\d{2}$/.test(date_to)) {
    return NextResponse.json(
      { error: "date_from and date_to must be YYYY-MM-DD" },
      { status: 400 }
    );
  }

  if (date_from > date_to) {
    return NextResponse.json(
      { error: "date_from must be on or before date_to" },
      { status: 400 }
    );
  }

  const supabase = await makeSupabaseServer();

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

  // 3. Role — teacher must be assigned to this class
  const { data: roleData } = await supabase.rpc("phase1_active_role");
  const activeRole = (roleData as string | null) ?? "";

  if (!HR_ACCESS_ROLES.has(activeRole) && activeRole !== "teacher") {
    return NextResponse.json({ error: "not authorized" }, { status: 403 });
  }

  if (activeRole === "teacher") {
    const { data: assignments } = await supabase
      .from("teacher_assignments")
      .select("class_id")
      .eq("user_id", user.id)
      .eq("organization_id", orgId);
    const allowed = new Set((assignments ?? []).map((a: { class_id: string }) => a.class_id));
    if (!allowed.has(class_id)) {
      return NextResponse.json({ error: "not authorized for this class" }, { status: 403 });
    }
  }

  // 4. Verify class belongs to org
  const { data: classRow, error: classErr } = await supabase
    .from("classes")
    .select("id, name")
    .eq("id", class_id)
    .eq("organization_id", orgId)
    .single();

  if (classErr || !classRow) {
    return NextResponse.json({ error: "class not found" }, { status: 403 });
  }

  // 5. Fetch attendance records
  const { data: records, error: recordsErr } = await supabase
    .from("attendance_records")
    .select("student_id, date, session, status_code")
    .eq("organization_id", orgId)
    .eq("class_id", class_id)
    .gte("date", date_from)
    .lte("date", date_to)
    .is("subject_id", null)
    .order("date", { ascending: true });

  if (recordsErr) {
    return NextResponse.json({ error: recordsErr.message }, { status: 500 });
  }

  const allRecords = (records ?? []) as {
    student_id: string; date: string; session: string; status_code: string;
  }[];

  // 6. Fetch students enrolled in this class
  const { data: enrollments } = await supabase
    .from("class_enrollments")
    .select("student_id, students(id, student_code, first_name, last_name)")
    .eq("class_id", class_id)
    .eq("active", true);

  type EnrollmentRow = {
    student_id: string;
    students: { id: string; student_code: string; first_name: string; last_name: string } | null;
  };

  const students = ((enrollments ?? []) as unknown as EnrollmentRow[])
    .filter(e => e.students)
    .map(e => ({
      student_id: e.student_id,
      student_code: e.students!.student_code,
      full_name: `${e.students!.first_name} ${e.students!.last_name}`,
    }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  // 7. Fetch status labels
  const { data: statusRows } = await supabase
    .from("attendance_statuses")
    .select("code, label, counts_as_present")
    .eq("active", true);

  const statuses = (statusRows ?? []) as { code: string; label: string; counts_as_present: boolean }[];

  // Unique sorted dates
  const dates = [...new Set(allRecords.map(r => r.date))].sort();

  // 8. Return
  if (format === "csv") {
    const statusMap = new Map(statuses.map(s => [s.code, s.label]));
    const studentMap = new Map(students.map(s => [s.student_id, s]));

    const header = "Student Code,Student Name,Date,Session,Status\r\n";
    const rows = allRecords
      .map(r => {
        const stu = studentMap.get(r.student_id);
        const studentCode = stu?.student_code ?? "";
        const fullName = stu?.full_name ?? "Unknown";
        const statusLabel = statusMap.get(r.status_code) ?? r.status_code;
        // Escape CSV fields
        const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
        return `${esc(studentCode)},${esc(fullName)},${esc(r.date)},${esc(r.session)},${esc(statusLabel)}`;
      })
      .join("\r\n");

    const csvBody = header + rows;
    const filename = `attendance_${classRow.name.replace(/\s+/g, "_")}_${date_from}_to_${date_to}.csv`;

    return new NextResponse(csvBody, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  return NextResponse.json({
    class_name: classRow.name,
    date_from,
    date_to,
    students,
    dates,
    records: allRecords,
    statuses,
  });
}
