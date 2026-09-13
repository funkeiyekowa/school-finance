import { supabase } from "@/lib/supabase";

/**
 * Student / parent attendance view — read-only.
 *
 * Adds NO backend surface and writes nothing. The security boundary is already
 * in the database and is not re-implemented here:
 *
 *   my_linked_student_ids()  (SECURITY DEFINER, granted to authenticated)
 *     = students.profile_id = auth.uid()            -- the student themself
 *       UNION
 *       parent_profiles → parent_student_links       -- that parent's children
 *
 * RLS policy `attendance_self_read` on attendance_records and
 * `students_self_read` on students both restrict SELECT to exactly that set, so
 * a student cannot read a classmate's attendance and a parent cannot read a
 * child who is not linked to them — regardless of what this client asks for.
 * The queries below therefore do not filter by organization_id at all; doing so
 * would be a client-side guess at a boundary the server already owns.
 */

export interface LinkedStudent {
  id: string;
  fullName: string;
  studentCode: string | null;
  grade: string | null;
}

export interface AttendanceRecord {
  id: string;
  date: string;
  session: string;
  statusCode: string;
  classId: string | null;
  subjectId: string | null;
  captureMethod: string | null;
}

export interface StatusMeta {
  code: string;
  label: string;
  isPresent: boolean;
}

export interface AttendanceSummary {
  total: number;
  present: number;
  absent: number;
  other: number;
  ratePercent: number | null;
  byStatus: { code: string; label: string; count: number }[];
}

/** Students this user may view: themself, or their linked children. */
export async function fetchLinkedStudents(): Promise<LinkedStudent[]> {
  const { data: idRows, error: idError } = await supabase.rpc("my_linked_student_ids");
  if (idError) throw new Error("Could not confirm which student records you can view.");

  const ids = (Array.isArray(idRows) ? idRows : [])
    .map((r) => (r as { student_id?: string }).student_id)
    .filter((v): v is string => Boolean(v));
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from("students")
    .select("id, full_name, student_code, grade")
    .in("id", ids)
    .order("full_name");
  if (error) throw new Error("Could not load student details.");

  return ((data as { id: string; full_name: string; student_code: string | null; grade: string | null }[]) ?? []).map(
    (r) => ({ id: r.id, fullName: r.full_name, studentCode: r.student_code, grade: r.grade }),
  );
}

/**
 * Status reference rows. `attendance_statuses` is an org-readable reference
 * table (policy attendance_statuses_member_read), so labels render correctly
 * for students and parents without any staff-only access.
 */
export async function fetchStatusMeta(): Promise<StatusMeta[]> {
  const { data } = await supabase.from("attendance_statuses").select("*").eq("active", true).order("sort_order");
  const rows = (data as Record<string, unknown>[]) ?? [];
  return rows
    .filter((r) => typeof r.code === "string")
    .map((r) => {
      const code = r.code as string;
      return {
        code,
        label: (r.label as string) || code,
        isPresent: derivePresent(code, r),
      };
    });
}

/**
 * Whether a status counts as "present" for the rate. Prefers an explicit
 * column if the schema has one; otherwise falls back to the code, matching how
 * the web student page reads it.
 */
function derivePresent(code: string, row: Record<string, unknown>): boolean {
  if (typeof row.counts_as_present === "boolean") return row.counts_as_present;
  if (typeof row.is_present === "boolean") return row.is_present;
  const c = code.toLowerCase();
  return c === "present" || c === "late" || c === "present_late";
}

export async function fetchAttendance(studentId: string, from: string, to: string): Promise<AttendanceRecord[]> {
  const { data, error } = await supabase
    .from("attendance_records")
    .select("id, date, session, status_code, class_id, subject_id, capture_method")
    .eq("student_id", studentId)
    .gte("date", from)
    .lte("date", to)
    .order("date", { ascending: false })
    .order("session");
  if (error) throw new Error("Could not load attendance records.");

  return ((data as Record<string, unknown>[]) ?? []).map((r) => ({
    id: r.id as string,
    date: r.date as string,
    session: (r.session as string) || "full_day",
    statusCode: (r.status_code as string) || "",
    classId: (r.class_id as string | null) ?? null,
    subjectId: (r.subject_id as string | null) ?? null,
    captureMethod: (r.capture_method as string | null) ?? null,
  }));
}

export function summarise(records: AttendanceRecord[], statuses: StatusMeta[]): AttendanceSummary {
  const meta = new Map(statuses.map((s) => [s.code, s]));
  const counts = new Map<string, number>();
  let present = 0;
  let absent = 0;
  let other = 0;

  for (const r of records) {
    counts.set(r.statusCode, (counts.get(r.statusCode) ?? 0) + 1);
    const m = meta.get(r.statusCode);
    if (m?.isPresent) present += 1;
    else if (r.statusCode.toLowerCase() === "absent") absent += 1;
    else other += 1;
  }

  return {
    total: records.length,
    present,
    absent,
    other,
    ratePercent: records.length > 0 ? Math.round((present / records.length) * 100) : null,
    byStatus: [...counts.entries()]
      .map(([code, count]) => ({ code, label: meta.get(code)?.label ?? code, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/** Class id → name, for labelling records. Reference table, member-readable. */
export async function fetchClassNames(): Promise<Map<string, string>> {
  const { data } = await supabase.from("classes").select("id, name");
  const rows = (data as { id: string; name: string }[]) ?? [];
  return new Map(rows.map((r) => [r.id, r.name]));
}

export interface RangeOption {
  key: string;
  label: string;
  days: number;
}

export const RANGE_OPTIONS: RangeOption[] = [
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
  { key: "365", label: "This year", days: 365 },
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local-date range, so an evening view never shifts a day under UTC. */
export function rangeFor(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { from: iso(from), to: iso(to) };
}

export function prettyDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function sessionLabel(session: string): string {
  if (session === "full_day") return "Full day";
  if (session === "morning") return "Morning";
  if (session === "afternoon") return "Afternoon";
  return session.replace(/_/g, " ");
}
