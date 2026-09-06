/**
 * Static contract tests for role-scoped timetable access
 * (supabase/fix_timetable_role_scoped_access.sql +
 *  src/app/dashboard/timetable/{page.tsx,print/page.tsx}).
 *
 * Same convention as phase1-authorization.test.ts: these check that the
 * required security-relevant source patterns exist and that no obvious
 * bypass shape (USING (true), an unfiltered class_id, role-filtered
 * teacher_assignments queries that would break the class_teacher +
 * subject_teacher union) has crept back in. They do NOT connect to a
 * live database -- live Supabase role/account verification (the seven
 * scenarios below) remains required against a real project.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..", "..");
const migration = fs.readFileSync(path.join(root, "supabase", "fix_timetable_role_scoped_access.sql"), "utf8");
const timetablePage = fs.readFileSync(path.join(root, "src", "app", "dashboard", "timetable", "page.tsx"), "utf8");
const printPage = fs.readFileSync(path.join(root, "src", "app", "dashboard", "timetable", "print", "page.tsx"), "utf8");

// ---------------------------------------------------------------------
// 1. Required SQL contracts exist.
// ---------------------------------------------------------------------
const requiredSqlContracts = [
  "is_non_teacher_staff",
  "is_assigned_to_class",
  "is_my_current_class",
  "get_my_current_class_id",
  "timetable_entries_role_scoped_read",
  "timetable_entries_staff_insert",
  "timetable_entries_staff_update",
  "timetable_entries_staff_delete",
];
for (const contract of requiredSqlContracts) {
  assert.match(migration, new RegExp(contract), `missing timetable security contract: ${contract}`);
}

// ---------------------------------------------------------------------
// 2. The read policy is not a wildcard -- must reference all three
//    authorization branches (staff / assigned teacher / own class).
// ---------------------------------------------------------------------
const readPolicyMatch = migration.match(
  /CREATE POLICY timetable_entries_role_scoped_read[\s\S]*?FOR SELECT USING \(([\s\S]*?)\);/
);
assert.ok(readPolicyMatch, "timetable_entries_role_scoped_read policy body not found");
const readPolicyBody = readPolicyMatch![1];
assert.doesNotMatch(readPolicyBody, /USING\s*\(\s*true\s*\)/i, "read policy must not be a bare USING (true)");
assert.match(readPolicyBody, /current_user_org_id\(\)/, "read policy must stay org-scoped");
assert.match(readPolicyBody, /is_non_teacher_staff\(\)/);
assert.match(readPolicyBody, /is_assigned_to_class\(class_id\)/);
assert.match(readPolicyBody, /is_my_current_class\(class_id\)/);

// ---------------------------------------------------------------------
// 3. Scenario 3/4 -- teacher_assignments union: is_assigned_to_class must
//    NOT filter by role, or a subject teacher's rows (role='subject_teacher')
//    or a class teacher's rows (role='class_teacher') could be excluded.
//    It must require an active row scoped to the specific class.
// ---------------------------------------------------------------------
const assignedFnMatch = migration.match(
  /CREATE OR REPLACE FUNCTION public\.is_assigned_to_class[\s\S]*?\$\$;/
);
assert.ok(assignedFnMatch, "is_assigned_to_class function body not found");
const assignedFnBody = assignedFnMatch![0];
assert.doesNotMatch(assignedFnBody, /role\s*=\s*'class_teacher'/, "must not be narrowed to class_teacher only (breaks subject-teacher union)");
assert.doesNotMatch(assignedFnBody, /role\s*=\s*'subject_teacher'/, "must not be narrowed to subject_teacher only (breaks class-teacher union)");
assert.match(assignedFnBody, /ta\.class_id\s*=\s*p_class/);
assert.match(assignedFnBody, /ta\.active\s*=\s*true/);
assert.match(assignedFnBody, /ta\.user_id\s*=\s*auth\.uid\(\)/);

// ---------------------------------------------------------------------
// 4. Scenario 1/2 -- student resolution goes through student_enrollments
//    (student_current_class_id / my_linked_student_ids), never a
//    client-supplied class id, and there is no OR clause that would let
//    an arbitrary class_id in for a student.
// ---------------------------------------------------------------------
const myClassFnMatch = migration.match(
  /CREATE OR REPLACE FUNCTION public\.is_my_current_class[\s\S]*?\$\$;/
);
assert.ok(myClassFnMatch, "is_my_current_class function body not found");
assert.match(myClassFnMatch![0], /student_current_class_id/);
assert.match(myClassFnMatch![0], /my_linked_student_ids/);

const getMyClassFnMatch = migration.match(
  /CREATE OR REPLACE FUNCTION public\.get_my_current_class_id[\s\S]*?\$\$;/
);
assert.ok(getMyClassFnMatch, "get_my_current_class_id function body not found");
assert.match(getMyClassFnMatch![0], /profile_id\s*=\s*auth\.uid\(\)/, "must resolve the caller's own student row server-side, never trust a client-supplied id");

// ---------------------------------------------------------------------
// 5. Scenario 6/7 -- write policies unchanged (staff-only), and the
//    non-teacher-staff branch still grants admins full read access.
// ---------------------------------------------------------------------
for (const writePolicy of ["timetable_entries_staff_insert", "timetable_entries_staff_update", "timetable_entries_staff_delete"]) {
  const m = migration.match(new RegExp(`CREATE POLICY ${writePolicy}[\\s\\S]*?;`));
  assert.ok(m, `${writePolicy} not found`);
  assert.match(m![0], /is_staff_user\(\)/, `${writePolicy} must remain staff-gated`);
}
const nonTeacherStaffMatch = migration.match(/CREATE OR REPLACE FUNCTION public\.is_non_teacher_staff[\s\S]*?\$\$;/);
assert.ok(nonTeacherStaffMatch, "is_non_teacher_staff function body not found");
for (const adminRole of ["owner", "admin", "super_admin"]) {
  assert.match(nonTeacherStaffMatch![0], new RegExp(`'${adminRole}'`), `is_non_teacher_staff must include admin-capable role: ${adminRole}`);
}
assert.doesNotMatch(nonTeacherStaffMatch![0], /'teacher'/, "is_non_teacher_staff must exclude 'teacher' -- that role is scoped via is_assigned_to_class instead");

// ---------------------------------------------------------------------
// 6. Client: students never see a manual class selector, and the
//    resolved class comes from the server RPC, not local state seeded
//    from a URL/query param.
// ---------------------------------------------------------------------
assert.match(timetablePage, /get_my_current_class_id/, "timetable page must call the server-resolved class RPC for student-like users");
assert.match(timetablePage, /isStudentLike/);
assert.match(timetablePage, /isStudentLike \|\| \(isTeacherRole && classes\.length <= 1\)/, "selector must be hidden for students (and single-class teachers)");

// Teacher scoping must reuse teacher_assignments unfiltered by role (the
// union), matching src/app/dashboard/teaching/page.tsx's own pattern.
const teacherAssignQueryMatch = timetablePage.match(/from\("teacher_assignments"\)[\s\S]*?;/);
assert.ok(teacherAssignQueryMatch, "teacher_assignments query not found in timetable page");
assert.doesNotMatch(teacherAssignQueryMatch![0], /\.eq\("role"/, "must not filter teacher_assignments by role -- would break the class_teacher/subject_teacher union");

// ---------------------------------------------------------------------
// 7. Print page: must not blindly trust ?class= for non-privileged
//    callers (the literal "manipulate the URL" bypass named in the ask).
// ---------------------------------------------------------------------
assert.match(printPage, /isPrivilegedStaff/);
assert.match(printPage, /get_my_current_class_id/);
assert.match(printPage, /teacher_assignments/);
assert.match(printPage, /setDenied\(true\)/);

// ---------------------------------------------------------------------
// Persona matrix documenting the seven required scenarios (mirrors the
// Persona/matrix pattern in phase1-authorization.test.ts).
// ---------------------------------------------------------------------
type Persona = "student_own_class" | "student_other_class" | "teacher_multi_class" | "subject_teacher_multi_class" | "teacher_unrelated_class" | "admin" | "existing_functionality";
const matrix: Record<Persona, { allow: string[]; deny: string[] }> = {
  student_own_class: { allow: ["own_class_timetable"], deny: [] },
  student_other_class: { allow: [], deny: ["other_class_via_url", "other_class_via_rpc"] },
  teacher_multi_class: { allow: ["class_teacher_assigned_classes"], deny: ["unassigned_classes"] },
  subject_teacher_multi_class: { allow: ["subject_teacher_assigned_classes_across_multiple_classes"], deny: ["unassigned_classes"] },
  teacher_unrelated_class: { allow: [], deny: ["unrelated_class"] },
  admin: { allow: ["all_classes"], deny: [] },
  existing_functionality: { allow: ["staff_write_unchanged", "class_subject_period_reference_reads_unchanged"], deny: [] },
};
assert.equal(Object.keys(matrix).length, 7);

console.log(`Timetable role-scoped access contract checks passed for ${Object.keys(matrix).length} scenarios.`);
console.log("Live Supabase role/account tests (real student/teacher/admin sessions against real class ids) remain required; this test intentionally does not claim database verification.");
