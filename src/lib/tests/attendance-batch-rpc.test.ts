/**
 * Static contract tests for the Attendance Multi-Capture Platform — Phase 1
 * (supabase/20260907120000_attendance_batch_rpc.sql +
 *  src/app/dashboard/attendance/page.tsx).
 *
 * Same convention as phase1-authorization.test.ts /
 * timetable-authorization.test.ts / timetable-setup.test.ts:
 * these check that the required security- and correctness-relevant
 * source patterns exist, and that this phase has not crept into
 * touching allocation data or existing RLS/trigger policies.
 * They do NOT connect to a live database — live Supabase
 * verification (admin can save attendance, teacher can save for
 * assigned class, student cannot save, batch is atomic) remains
 * required against a real project.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..", "..");
const migration = fs.readFileSync(path.join(root, "supabase", "20260907120000_attendance_batch_rpc.sql"), "utf8");
const attendancePage = fs.readFileSync(path.join(root, "src", "app", "dashboard", "attendance", "page.tsx"), "utf8");
const phase1Security = fs.readFileSync(path.join(root, "supabase", "20260905120000_phase1_security_enforcement.sql"), "utf8");

// ================================================================
// 1. Additive columns exist in the migration
// ================================================================
assert.match(migration, /ALTER TABLE public\.attendance_records\s*\n\s*ADD COLUMN IF NOT EXISTS capture_method/, "must add capture_method column");
assert.match(migration, /ALTER TABLE public\.attendance_records\s*\n\s*ADD COLUMN IF NOT EXISTS recorded_by_user_id/, "must add recorded_by_user_id column");

// 2. capture_method defaults to 'manual'
assert.match(migration, /capture_method text NOT NULL DEFAULT 'manual'/, "capture_method must be NOT NULL DEFAULT 'manual'");

// ================================================================
// 3. record_attendance_batch RPC exists with correct signature
// ================================================================
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.record_attendance_batch\(/, "must create record_attendance_batch function");
assert.match(migration, /p_class_id uuid/, "RPC must accept p_class_id uuid");
assert.match(migration, /p_date date/, "RPC must accept p_date date");
assert.match(migration, /p_session text/, "RPC must accept p_session text");
assert.match(migration, /p_marks jsonb/, "RPC must accept p_marks jsonb");
assert.match(migration, /RETURNS jsonb/, "RPC must return jsonb");
assert.match(migration, /SECURITY DEFINER/, "RPC must be SECURITY DEFINER");
assert.match(migration, /SET search_path = public/, "RPC must pin search_path");

// 4. RPC resolves org server-side, never trusts client
assert.match(migration, /current_user_org_id\(\)/, "must resolve org via current_user_org_id()");
assert.doesNotMatch(migration, /p_org(anization)?_id/i, "must NOT accept a client-supplied organization id parameter");

// 5. RPC validates caller authorization
assert.match(migration, /phase1_hr_access\(\)/, "must check phase1_hr_access for staff roles");
assert.match(migration, /phase1_active_role\(\)/, "must check phase1_active_role for teacher");
assert.match(migration, /teacher_assignments/, "must validate teacher assignment for the class");

// 6. RPC validates students belong to caller's org
assert.match(migration, /students s[\s\S]*?s\.organization_id\s*=\s*v_org_id/, "must validate student belongs to caller's org");

// 7. RPC validates status_codes against attendance_statuses
assert.match(migration, /attendance_statuses/, "must validate status_code against attendance_statuses");

// 8. RPC preserves "complete roster state" — DELETE for the
// whole class/date/session, not just the submitted students
const deleteMatch = migration.match(/DELETE FROM public\.attendance_records[\s\S]*?AND subject_id IS NULL;/);
assert.ok(deleteMatch, "must DELETE existing daily attendance rows for the class/date/session/org atomically");
assert.match(deleteMatch![0], /class_id = p_class_id/, "DELETE must scope to class_id");
assert.match(deleteMatch![0], /date = p_date/, "DELETE must scope to date");
assert.match(deleteMatch![0], /session = p_session/, "DELETE must scope to session");
// The DELETE must NOT be scoped to specific student_ids — it replaces
// ALL attendance for this class/date/session (complete roster state).
assert.doesNotMatch(deleteMatch![0], /student_id\s*(=|IN)/, "DELETE must NOT filter by student_id — complete roster state semantics");
// The DELETE must scope to daily attendance only (subject_id IS NULL) so
// subject-specific attendance rows are not wiped by the batch RPC.
assert.match(deleteMatch![0], /subject_id IS NULL/, "DELETE must include subject_id IS NULL to scope to daily attendance only");

// 9. RPC sets capture_method and recorded_by_user_id
assert.match(migration, /capture_method.*'manual'/, "must set capture_method to 'manual'");
assert.match(migration, /recorded_by_user_id[\s\S]*?v_caller_uid/, "must set recorded_by_user_id from auth.uid()");
assert.match(migration, /v_caller_uid\s*:=\s*auth\.uid\(\)/, "must use auth.uid() for caller identification");

// 10. RPC writes activity_log (same shape as existing)
assert.match(migration, /INSERT INTO public\.activity_log/, "must write to activity_log");
assert.match(migration, /Record Attendance/, "activity_log action must be 'Record Attendance'");

// 11. GRANT to authenticated
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.record_attendance_batch.*TO authenticated/, "must grant execute to authenticated");

// ================================================================
// 12. Migration must NOT touch existing tables/policies
// ================================================================
const forbiddenPatterns = [
  [/ALTER TABLE public\.timetable_entries/, "must not alter timetable_entries"],
  [/ALTER TABLE public\.classes\b/, "must not alter classes"],
  [/ALTER TABLE public\.periods\b/, "must not alter periods"],
  [/ALTER TABLE public\.subjects\b/, "must not alter subjects"],
  [/DROP POLICY/, "must not drop any policy"],
  [/CREATE POLICY/, "must not create any policy"],
  [/CREATE TABLE/, "must not create any new table"],
  // phase1_sensitive_write_guard: the migration may MENTION it in
  // comments but must not ALTER, DROP, or CREATE the trigger/function.
  [/CREATE OR REPLACE FUNCTION.*phase1_sensitive_write_guard/, "must not redefine phase1_sensitive_write_guard"],
  [/DROP TRIGGER.*phase1_sensitive_write_guard/, "must not drop phase1_sensitive_write_guard trigger"],
  [/CREATE TRIGGER.*phase1_sensitive_write_guard/, "must not create phase1_sensitive_write_guard trigger"],
] as const;
for (const [pattern, msg] of forbiddenPatterns) {
  assert.doesNotMatch(migration, pattern, `migration ${msg}`);
}

// ================================================================
// 14. phase1_sensitive_write_guard is UNCHANGED
// ================================================================
// Verify the existing phase1 security migration still has the
// write guard with its attendance_records branch intact.
assert.match(phase1Security, /phase1_sensitive_write_guard/, "phase1_sensitive_write_guard must still exist");
assert.match(phase1Security, /attendance_records[\s\S]*?phase1_hr_access/, "write guard must still check hr_access for attendance_records");

// ================================================================
// 15. Attendance page uses the batch RPC, not direct table ops
// ================================================================
assert.match(attendancePage, /record_attendance_batch/, "attendance page must call record_attendance_batch RPC");
// The old pattern was .from("attendance_records").delete() / .insert() —
// verify neither direct table mutation pattern exists any more.
assert.doesNotMatch(attendancePage, /from\(\s*"attendance_records"\s*\)\s*\.delete/, "attendance page must NOT do client-side DELETE on attendance_records");
assert.doesNotMatch(attendancePage, /from\(\s*"attendance_records"\s*\)\s*\.insert/, "attendance page must NOT do client-side INSERT to attendance_records");

// 16. Attendance page must NOT send organization_id to the RPC
// (the RPC resolves it server-side)
const rpcCallMatch = attendancePage.match(/supabase\.rpc\(\s*"record_attendance_batch"[\s\S]*?\)/);
assert.ok(rpcCallMatch, "must call supabase.rpc('record_attendance_batch', ...)");
assert.doesNotMatch(rpcCallMatch![0], /organization_id/, "RPC call must not pass organization_id — resolved server-side");
assert.doesNotMatch(rpcCallMatch![0], /orgId/, "RPC call must not pass orgId — resolved server-side");

// 17. Attendance page must NOT send academic_year_id to the RPC
assert.doesNotMatch(rpcCallMatch![0], /academic_year/, "RPC call must not pass academic_year — resolved server-side");

// 18. Existing RLS policies on attendance_records are untouched
// (the phase1 security migration must still have them all).
const requiredPolicies = [
  "phase1_attendance_staff_all",
  "phase1_attendance_teacher_read",
  "phase1_attendance_teacher_insert",
  "phase1_attendance_teacher_update",
  "phase1_attendance_self_read",
];
for (const policy of requiredPolicies) {
  assert.match(phase1Security, new RegExp(policy), `existing RLS policy ${policy} must still exist in phase1 security migration`);
}

console.log("Attendance batch RPC contract checks passed.");
console.log("Live Supabase verification (admin can batch-save, teacher can save for assigned class, student cannot save, batch is atomic, capture_method and recorded_by_user_id are populated) remains required; this test intentionally does not claim database verification.");
