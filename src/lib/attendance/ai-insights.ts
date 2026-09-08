import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  InsightsRequest,
  AiPayload,
  AiPayloadStudentStat,
  AiPayloadClassStat,
  AiPayloadRecordingStat,
  AttendanceInsightsResponse,
  Finding,
  FindingType,
  FindingSeverity,
  FindingScope,
} from "./ai-insights-types";

// Build opaque ref: sha256(id + org_id + salt).slice(0,12)
// salt = date_from + date_to (deterministic within a request, changes per period)
function makeRef(id: string, orgId: string, salt: string): string {
  return crypto
    .createHash("sha256")
    .update(id + orgId + salt)
    .digest("hex")
    .slice(0, 12);
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export async function buildInsightsPayload(params: {
  supabase: SupabaseClient;
  org_id: string;
  allowed_class_ids: string[];
  request: InsightsRequest;
}): Promise<{ payload: AiPayload; refMap: Map<string, string> }> {
  const { supabase, org_id, allowed_class_ids, request } = params;
  const { date_from, date_to, capability } = request;
  const salt = date_from + date_to;

  // 1. Fetch attendance_records (subject_id IS NULL = class-level records only)
  const { data: records } = await supabase
    .from("attendance_records")
    .select("student_id, class_id, date, session, status_code")
    .eq("organization_id", org_id)
    .in("class_id", allowed_class_ids)
    .gte("date", date_from)
    .lte("date", date_to)
    .is("subject_id", null);

  const allRecords = (records ?? []) as {
    student_id: string;
    class_id: string;
    date: string;
    session: string;
    status_code: string;
  }[];

  // 2. Fetch attendance_statuses to know which codes are absent
  const { data: statusRows } = await supabase
    .from("attendance_statuses")
    .select("code, counts_as_present, is_default")
    .eq("active", true);

  const presentCodes = new Set<string>();
  for (const s of (statusRows ?? []) as { code: string; counts_as_present: boolean; is_default: boolean }[]) {
    if (s.counts_as_present) presentCodes.add(s.code);
  }

  // 3. Fetch students in scope
  const studentIds = [...new Set(allRecords.map((r) => r.student_id))];
  let studentMap = new Map<string, { full_name: string; student_code: string }>();
  if (studentIds.length > 0) {
    const { data: stuRows } = await supabase
      .from("students")
      .select("id, full_name, student_code")
      .eq("organization_id", org_id)
      .in("id", studentIds);
    for (const s of (stuRows ?? []) as { id: string; full_name: string; student_code: string }[]) {
      studentMap.set(s.id, { full_name: s.full_name, student_code: s.student_code });
    }
  }

  // 4. Fetch classes
  const { data: classRows } = await supabase
    .from("classes")
    .select("id, name, short_code")
    .in("id", allowed_class_ids);

  const classMap = new Map<string, { name: string; short_code: string }>();
  for (const c of (classRows ?? []) as { id: string; name: string; short_code: string }[]) {
    classMap.set(c.id, { name: c.name, short_code: c.short_code });
  }

  // 5. Build refMap
  const refMap = new Map<string, string>();
  for (const [id, info] of studentMap.entries()) {
    const ref = makeRef(id, org_id, salt);
    refMap.set(ref, info.full_name);
  }
  for (const [id, info] of classMap.entries()) {
    const ref = makeRef(id, org_id, salt);
    refMap.set(ref, info.short_code || info.name);
  }

  // ---- Per-student stats ----
  // Group records by student
  const byStudent = new Map<string, typeof allRecords>();
  for (const r of allRecords) {
    if (!byStudent.has(r.student_id)) byStudent.set(r.student_id, []);
    byStudent.get(r.student_id)!.push(r);
  }

  // Compute total sessions per class for roster size estimation
  const allDates = [...new Set(allRecords.map((r) => r.date))].sort();

  const student_stats: AiPayloadStudentStat[] = [];
  for (const [studentId, recs] of byStudent.entries()) {
    const total = recs.length;
    if (total === 0) continue;
    const absentRecs = recs.filter((r) => !presentCodes.has(r.status_code));
    const absence_rate_pct = Math.round((absentRecs.length / total) * 100);

    // Day-of-week pattern for absences
    const dowPattern: Record<string, number> = {};
    for (const r of absentRecs) {
      const d = new Date(r.date);
      const dayName = DAY_NAMES[d.getUTCDay()];
      dowPattern[dayName] = (dowPattern[dayName] ?? 0) + 1;
    }

    // Sessions absent — list of "date:session" where absent
    const sessionsAbsent = absentRecs.map((r) => `${r.date}:${r.session}`);

    // Consecutive absences: count backward from date_to
    const absentDates = new Set(absentRecs.map((r) => r.date));
    const sortedDates = [...new Set(recs.map((r) => r.date))].sort().reverse();
    let consecutive_absences = 0;
    for (const d of sortedDates) {
      if (absentDates.has(d)) consecutive_absences++;
      else break;
    }

    // Only include if above threshold
    if (absence_rate_pct > 15 || consecutive_absences >= 3) {
      const ref = makeRef(studentId, org_id, salt);
      student_stats.push({
        ref,
        absence_rate_pct,
        consecutive_absences,
        sessions_absent: sessionsAbsent.slice(0, 20), // cap to keep payload small
        day_of_week_pattern: dowPattern,
      });
    }
  }

  // ---- Per-class stats ----
  const byClass = new Map<string, typeof allRecords>();
  for (const r of allRecords) {
    if (!byClass.has(r.class_id)) byClass.set(r.class_id, []);
    byClass.get(r.class_id)!.push(r);
  }

  // School-wide rate
  const totalRecords = allRecords.length;
  const totalPresent = allRecords.filter((r) => presentCodes.has(r.status_code)).length;
  const school_avg = totalRecords > 0 ? Math.round((totalPresent / totalRecords) * 100) : 0;

  const class_stats: AiPayloadClassStat[] = [];
  for (const [classId, recs] of byClass.entries()) {
    const total = recs.length;
    if (total === 0) continue;
    const presentCount = recs.filter((r) => presentCodes.has(r.status_code)).length;
    const avg_attendance_rate_pct = Math.round((presentCount / total) * 100);

    // Lowest day
    const byDate = new Map<string, { total: number; present: number }>();
    for (const r of recs) {
      if (!byDate.has(r.date)) byDate.set(r.date, { total: 0, present: 0 });
      const d = byDate.get(r.date)!;
      d.total++;
      if (presentCodes.has(r.status_code)) d.present++;
    }
    let lowest_day = "";
    let lowest_rate = 101;
    for (const [date, d] of byDate.entries()) {
      const rate = d.total > 0 ? Math.round((d.present / d.total) * 100) : 0;
      if (rate < lowest_rate) { lowest_rate = rate; lowest_day = date; }
    }

    const ref = makeRef(classId, org_id, salt);
    class_stats.push({
      ref,
      avg_attendance_rate_pct,
      school_avg_delta: avg_attendance_rate_pct - school_avg,
      lowest_day,
      lowest_rate,
    });
  }

  // ---- Recording stats ----
  const recording_stats: AiPayloadRecordingStat[] = [];
  for (const classId of allowed_class_ids) {
    const recs = byClass.get(classId) ?? [];
    const classRef = makeRef(classId, org_id, salt);

    // Dates with no record for this class
    const datesWithRecord = new Set(recs.map((r) => r.date));
    const dates_with_no_record = allDates.filter((d) => !datesWithRecord.has(d));

    // Dates with partial record (< 50% of the max roster size for this class)
    const byDate = new Map<string, number>();
    for (const r of recs) {
      byDate.set(r.date, (byDate.get(r.date) ?? 0) + 1);
    }
    const maxDayCount = Math.max(...(byDate.size > 0 ? [...byDate.values()] : [0]));
    const dates_with_partial_record: string[] = [];
    for (const [date, count] of byDate.entries()) {
      if (maxDayCount > 0 && count / maxDayCount < 0.5) {
        dates_with_partial_record.push(date);
      }
    }

    // Unusual bulk changes: days where all present after all absent (or vice versa)
    const unusual_bulk_changes: string[] = [];
    const sortedClassDates = [...datesWithRecord].sort();
    for (let i = 1; i < sortedClassDates.length; i++) {
      const prevDate = sortedClassDates[i - 1];
      const currDate = sortedClassDates[i];
      const prevRecs = recs.filter((r) => r.date === prevDate);
      const currRecs = recs.filter((r) => r.date === currDate);
      const prevAllAbsent = prevRecs.length > 0 && prevRecs.every((r) => !presentCodes.has(r.status_code));
      const currAllPresent = currRecs.length > 0 && currRecs.every((r) => presentCodes.has(r.status_code));
      if (prevAllAbsent && currAllPresent) {
        unusual_bulk_changes.push(`${prevDate}→${currDate}`);
      }
    }

    if (
      dates_with_no_record.length > 0 ||
      dates_with_partial_record.length > 0 ||
      unusual_bulk_changes.length > 0
    ) {
      recording_stats.push({
        ref: classRef,
        dates_with_no_record,
        dates_with_partial_record,
        unusual_bulk_changes,
      });
    }
  }

  const payload: AiPayload = {
    context: {
      date_from,
      date_to,
      school_avg_attendance_rate: school_avg,
      total_students_in_scope: studentIds.length,
      total_classes_in_scope: allowed_class_ids.length,
    },
    student_stats,
    class_stats,
    recording_stats,
    capabilities_requested: [capability],
  };

  return { payload, refMap };
}

const VALID_TYPES = new Set<FindingType>(["fact", "pattern", "suggestion", "data_quality_issue"]);
const VALID_SEVERITIES = new Set<FindingSeverity>(["info", "warning", "alert"]);
const VALID_SCOPES = new Set<FindingScope>(["student", "class", "school", "recording"]);

export function validateAndSanitizeResponse(raw: unknown): AttendanceInsightsResponse {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("AI response is not valid JSON");
    }
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI response must be an object");
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.summary !== "string" || !obj.summary.trim()) {
    throw new Error("AI response missing required 'summary' string");
  }

  const rawFindings = Array.isArray(obj.findings) ? obj.findings : [];
  const findings: Finding[] = [];

  for (const item of rawFindings) {
    if (!item || typeof item !== "object") continue;
    const f = item as Record<string, unknown>;

    const type = VALID_TYPES.has(f.type as FindingType) ? (f.type as FindingType) : null;
    if (!type) continue;

    const severity = VALID_SEVERITIES.has(f.severity as FindingSeverity)
      ? (f.severity as FindingSeverity)
      : "info";

    const scope = VALID_SCOPES.has(f.scope as FindingScope) ? (f.scope as FindingScope) : null;
    if (!scope) continue;

    if (typeof f.ref !== "string" || !f.ref) continue;
    if (typeof f.title !== "string" || !f.title) continue;
    if (typeof f.detail !== "string" || !f.detail) continue;

    const finding: Finding = {
      type,
      severity,
      scope,
      ref: f.ref,
      title: f.title,
      detail: f.detail,
    };

    // Only keep suggested_action for suggestions
    if (type === "suggestion" && typeof f.suggested_action === "string" && f.suggested_action) {
      finding.suggested_action = f.suggested_action;
    }

    findings.push(finding);
  }

  return {
    generated_at: new Date().toISOString(),
    summary: obj.summary,
    findings,
  };
}

export function resolveRefs(
  response: AttendanceInsightsResponse,
  refMap: Map<string, string>
): AttendanceInsightsResponse {
  return {
    ...response,
    findings: response.findings.map((f) => ({
      ...f,
      display_name: refMap.get(f.ref) ?? "Unknown",
    })),
  };
}
