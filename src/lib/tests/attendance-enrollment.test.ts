/**
 * Static contract tests for Attendance Phase 3 — enrollment validation.
 * (supabase/20260907140000_class_enrollment.sql)
 *
 * Verifies that:
 *  1. is_student_enrolled_in_class() helper exists with correct security shape.
 *  2. ingest_attendance_from_device() rejects unenrolled students.
 *  3. The enrollment check uses student_enrollments (not students.grade).
 *  4. Phase 2 ingest contract is not broken (regression).
 *  5. record_attendance_batch() is NOT changed.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..", "..");

const phase3 = fs.readFileSync(
  path.join(root, "supabase", "20260907140000_class_enrollment.sql"),
  "utf8"
);
const phase2 = fs.readFileSync(
  path.join(root, "supabase", "20260907130000_attendance_capture_devices.sql"),
  "utf8"
);

// ================================================================
// 1. is_student_enrolled_in_class helper
// ================================================================

// Function must exist
assert.match(
  phase3,
  /CREATE OR REPLACE FUNCTION public\.is_student_enrolled_in_class\(/,
  "helper function must be created"
);

// Must accept correct 4-param signature
assert.match(
  phase3,
  /is_student_enrolled_in_class\(\s*\n?\s*p_student_id\s+uuid,[\s\S]*?p_class_id\s+uuid,[\s\S]*?p_org_id\s+uuid,[\s\S]*?p_academic_year_id\s+uuid/,
  "helper must accept (student_id, class_id, org_id, academic_year_id)"
);

// Must be SECURITY DEFINER with pinned search_path
assert.match(
  phase3,
  /SECURITY DEFINER[\s\S]*?SET search_path = public/,
  "helper must be SECURITY DEFINER with pinned search_path"
);

// Must query student_enrollments — NOT students.grade
assert.match(
  phase3,
  /FROM public\.student_enrollments/,
  "helper must query student_enrollments table"
);
assert.doesNotMatch(
  phase3,
  /students\.grade/,
  "helper must NOT use students.grade as enrollment source"
);

// Must filter by all four dimensions
assert.match(phase3, /se\.student_id\s*=\s*p_student_id/, "must filter by student_id");
assert.match(phase3, /se\.class_id\s*=\s*p_class_id/, "must filter by class_id");
assert.match(phase3, /se\.organization_id\s*=\s*p_org_id/, "must filter by org_id");
assert.match(phase3, /se\.academic_year_id\s*=\s*p_academic_year_id/, "must filter by academic_year_id");
assert.match(phase3, /se\.status\s*=\s*'active'/, "must only count active enrollments");

// ================================================================
// 2. ingest_attendance_from_device — enrollment check added
// ================================================================

// Ingest function must call the helper
assert.match(
  phase3,
  /public\.is_student_enrolled_in_class\(\s*[\s\S]*?v_device\.class_id[\s\S]*?\)/,
  "ingest function must call is_student_enrolled_in_class with device's class"
);

// Must raise a clear exception for unenrolled students
assert.match(
  phase3,
  /not enrolled in device class/,
  "ingest function must raise 'not enrolled in device class' for cross-class students"
);

// Academic year must be resolved BEFORE the mark-validation loop
// (so v_year_id is available for the enrollment check)
const resolveYearPos = phase3.indexOf("ay.status = 'current'");
const markLoopPos    = phase3.indexOf("jsonb_array_elements(p_marks)");
assert.ok(
  resolveYearPos < markLoopPos,
  "academic year resolution must occur before mark validation loop"
);

// ================================================================
// 3. Enrollment check uses student_enrollments, not grade text match
// ================================================================
assert.doesNotMatch(
  phase3,
  /students.*grade.*=.*classes.*name|classes.*name.*=.*students.*grade/,
  "must not use grade text matching as enrollment check"
);

// ================================================================
// 4. Phase 2 ingest regression — existing security checks preserved
// ================================================================
// The new migration replaces ingest_attendance_from_device; verify
// that its Phase 2 checks are still present.
assert.match(
  phase3,
  /invalid or inactive device/,
  "token validation must still be present"
);
assert.match(
  phase3,
  /device class not found in its organization/,
  "device-class org check must still be present"
);
assert.match(
  phase3,
  /student % not found in device org/,
  "student org check must still be present (before enrollment check)"
);
assert.match(
  phase3,
  /status_code % is not valid for this organization/,
  "status_code validation must still be present"
);
assert.match(
  phase3,
  /subject_id IS NULL/,
  "DELETE must still be scoped to daily attendance only"
);

// ================================================================
// 5. record_attendance_batch() must NOT be altered in Phase 3 migration
// ================================================================
// Comments may mention it; what's forbidden is a SQL CREATE/DROP/ALTER/GRANT on it.
assert.doesNotMatch(
  phase3,
  /(?:CREATE|DROP|ALTER|GRANT)[\s\S]{0,120}record_attendance_batch/,
  "Phase 3 migration must NOT CREATE/DROP/ALTER/GRANT record_attendance_batch"
);

// ================================================================
// 6. Phase 2 migration unchanged (enrollment check NOT in Phase 2)
// ================================================================
assert.doesNotMatch(
  phase2,
  /is_student_enrolled_in_class/,
  "Phase 2 migration must not reference the Phase 3 helper (retroactive edit guard)"
);

// ================================================================
// 7. Privilege boundaries
// ================================================================

// is_student_enrolled_in_class must be revoked from anon + authenticated
assert.match(
  phase3,
  /REVOKE[\s\S]{0,120}is_student_enrolled_in_class[\s\S]{0,60}FROM[\s\S]{0,60}anon/,
  "helper must REVOKE from anon"
);
assert.match(
  phase3,
  /REVOKE[\s\S]{0,120}is_student_enrolled_in_class[\s\S]{0,120}FROM[\s\S]{0,120}authenticated/,
  "helper must REVOKE from authenticated"
);

// ingest_attendance_from_device must REVOKE anon+authenticated and GRANT service_role
assert.match(
  phase3,
  /REVOKE[\s\S]{0,120}ingest_attendance_from_device[\s\S]{0,60}FROM[\s\S]{0,60}anon/,
  "ingest function must REVOKE from anon"
);
assert.match(
  phase3,
  /REVOKE[\s\S]{0,120}ingest_attendance_from_device[\s\S]{0,120}FROM[\s\S]{0,120}authenticated/,
  "ingest function must REVOKE from authenticated"
);
assert.match(
  phase3,
  /GRANT EXECUTE ON FUNCTION public\.ingest_attendance_from_device[\s\S]{0,60}TO service_role/,
  "ingest function must GRANT to service_role"
);

// Must NOT grant either function to authenticated
assert.doesNotMatch(
  phase3,
  /GRANT EXECUTE ON FUNCTION public\.ingest_attendance_from_device[\s\S]{0,60}TO authenticated/,
  "ingest function must NOT be granted to authenticated"
);
assert.doesNotMatch(
  phase3,
  /GRANT EXECUTE ON FUNCTION public\.is_student_enrolled_in_class[\s\S]{0,60}TO authenticated/,
  "helper must NOT be granted to authenticated"
);

console.log("Attendance enrollment contract checks passed.");
console.log(
  "Live verification required: enrolled student → 200; " +
  "same-org but unenrolled student → 422 'not enrolled in device class'; " +
  "cross-org student → 422 'not found in device org'."
);
