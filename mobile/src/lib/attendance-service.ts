import { supabase } from "@/lib/supabase";
import {
  DEFAULT_CAPTURE_CONFIG,
  type AttendanceRecordRow,
  type CaptureConfig,
  type ClassRow,
  type StatusRow,
  type StudentRow,
  type SubjectRow,
} from "@/lib/attendance-types";

/**
 * Mobile attendance capture — Phase 2.
 *
 * This module adds NO new backend surface. It calls exactly the same RPCs and
 * tables the web capture page (src/app/dashboard/attendance/page.tsx) already
 * uses, so the server remains the single authority:
 *
 *   - record_attendance_batch / record_attendance_subject_batch resolve the
 *     organisation, academic year and caller identity server-side and validate
 *     the class against them. The client supplies only class/date/session and
 *     per-student status codes — never an organization_id.
 *   - RLS on classes / students / subjects / attendance_records enforces tenant
 *     isolation for every read below.
 *
 * The teacher_assignments filtering here is a UX narrowing of what a teacher is
 * shown. It is deliberately NOT the security boundary — the batch RPCs reject
 * an unauthorised class regardless of what the client sends.
 */

function firstRow<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  return (value as T | null) ?? null;
}

export async function fetchCaptureConfig(): Promise<CaptureConfig> {
  const { data, error } = await supabase.rpc("get_my_attendance_capture_settings");
  if (error) return DEFAULT_CAPTURE_CONFIG;
  const row = firstRow<Partial<CaptureConfig>>(data);
  if (!row) return DEFAULT_CAPTURE_CONFIG;
  return {
    enabled_capture_methods: row.enabled_capture_methods ?? DEFAULT_CAPTURE_CONFIG.enabled_capture_methods,
    subject_attendance_enabled: row.subject_attendance_enabled ?? true,
    period_selection_enabled: row.period_selection_enabled ?? true,
    class_level_attendance_enabled: row.class_level_attendance_enabled ?? true,
    subject_required_for_attendance: row.subject_required_for_attendance ?? false,
    manual_session_enabled: row.manual_session_enabled ?? true,
    default_session: row.default_session ?? "full_day",
    default_attendance_mode: row.default_attendance_mode ?? "class",
  };
}

/**
 * Classes the signed-in user may capture for. Teachers are narrowed to their
 * active teacher_assignments; every other role gets the org's active classes
 * (RLS already scopes that list to their organisation).
 */
export async function fetchClasses(role: string, userId: string): Promise<ClassRow[]> {
  const { data, error } = await supabase
    .from("classes")
    .select("id, name, short_code, sequence, organization_id")
    .eq("active", true)
    .order("sequence");
  if (error) throw new Error("Could not load your classes. Pull down to retry.");

  const all = (data as ClassRow[]) ?? [];
  if (role !== "teacher") return all;

  const { data: assigned } = await supabase
    .from("teacher_assignments")
    .select("class_id")
    .eq("user_id", userId)
    .eq("active", true);
  const mine = new Set(((assigned as { class_id: string }[]) ?? []).map((r) => r.class_id));
  return all.filter((c) => mine.has(c.id));
}

export async function fetchStatuses(): Promise<StatusRow[]> {
  const { data } = await supabase
    .from("attendance_statuses")
    .select("*")
    .eq("active", true)
    .order("sort_order");
  return ((data as StatusRow[]) ?? []).filter((s) => Boolean(s?.code));
}

/**
 * Subjects available for a class. Mirrors GET /api/attendance/subjects:
 * a teacher holding a class-teacher assignment (subject_id IS NULL) sees every
 * active subject in the org; a subject teacher sees only their assigned ones.
 */
export async function fetchSubjects(
  classId: string,
  organizationId: string,
  role: string,
  userId: string,
): Promise<SubjectRow[]> {
  if (role === "teacher") {
    const { data: assignments } = await supabase
      .from("teacher_assignments")
      .select("class_id, subject_id")
      .eq("user_id", userId)
      .eq("organization_id", organizationId)
      .eq("class_id", classId)
      .eq("active", true);

    const rows = (assignments as { class_id: string; subject_id: string | null }[]) ?? [];
    if (rows.length === 0) return [];

    const isClassTeacher = rows.some((r) => r.subject_id === null);
    let query = supabase
      .from("subjects")
      .select("id, name, short_code")
      .eq("organization_id", organizationId)
      .eq("active", true)
      .order("name");

    if (!isClassTeacher) {
      const subjectIds = rows.map((r) => r.subject_id).filter((v): v is string => Boolean(v));
      if (subjectIds.length === 0) return [];
      query = query.in("id", subjectIds);
    }
    const { data } = await query;
    return (data as SubjectRow[]) ?? [];
  }

  const { data } = await supabase
    .from("subjects")
    .select("id, name, short_code")
    .eq("organization_id", organizationId)
    .eq("active", true)
    .order("name");
  return (data as SubjectRow[]) ?? [];
}

/**
 * Students in a class. Filtered by the class's own organization_id so that a
 * platform admin (whose RLS bypasses org isolation) only ever sees the students
 * of the school that owns the selected class — matching exactly what
 * record_attendance_batch() validates against server-side.
 */
export async function fetchStudents(cls: ClassRow): Promise<StudentRow[]> {
  const codeFilter = cls.short_code ? `,grade.eq.${cls.short_code}` : "";
  const { data, error } = await supabase
    .from("students")
    .select("id, student_code, full_name, grade")
    .eq("status", "active")
    .eq("organization_id", cls.organization_id)
    .or(`grade.eq.${cls.name}${codeFilter}`)
    .order("full_name");
  if (error) throw new Error("Could not load the student list for this class.");
  return (data as StudentRow[]) ?? [];
}

export async function fetchExistingRecords(params: {
  classId: string;
  date: string;
  session: string;
  subjectId: string | null;
}): Promise<AttendanceRecordRow[]> {
  let query = supabase
    .from("attendance_records")
    .select("id, student_id, status_code, remarks")
    .eq("date", params.date)
    .eq("session", params.session)
    .eq("class_id", params.classId);
  query = params.subjectId ? query.eq("subject_id", params.subjectId) : query.is("subject_id", null);
  const { data } = await query;
  return (data as AttendanceRecordRow[]) ?? [];
}

/**
 * Saves the roster. Sends only class/subject/date/session plus per-student
 * status codes — the RPC derives organisation, academic year and caller
 * identity itself and rejects a class the caller may not capture for.
 */
export async function saveAttendance(params: {
  classId: string;
  subjectId: string | null;
  date: string;
  session: string;
  marks: { student_id: string; status_code: string }[];
}): Promise<void> {
  const { error } = params.subjectId
    ? await supabase.rpc("record_attendance_subject_batch", {
        p_class_id: params.classId,
        p_subject_id: params.subjectId,
        p_date: params.date,
        p_session: params.session,
        p_marks: params.marks,
      })
    : await supabase.rpc("record_attendance_batch", {
        p_class_id: params.classId,
        p_date: params.date,
        p_session: params.session,
        p_marks: params.marks,
      });
  if (error) throw new Error(error.message || "Could not save attendance.");
}

/** Local YYYY-MM-DD (never UTC-shifted, which would mis-date evening capture). */
export function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
