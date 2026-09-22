import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..", "..");
const migration = fs.readFileSync(path.join(root, "supabase", "20260922013000_phase2_lms_rubrics.sql"), "utf8");
const scoreLookupFix = fs.readFileSync(path.join(root, "supabase", "20260922013100_phase2_lms_rubrics_score_lookup_fix.sql"), "utf8");

for (const table of ["lms_rubrics", "lms_rubric_criteria", "lms_rubric_scores"]) {
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
  assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
  assert.match(migration, new RegExp(`_reset_policies\\('${table}'\\)`));
}
assert.match(migration, /phase2_save_assignment_rubric/);
assert.match(migration, /phase2_grade_submission_with_rubric/);
assert.match(migration, /phase1_teacher_course_scope\(v_course\)/);
assert.match(migration, /Rubric total \(%\) must equal assignment maximum/);
assert.match(migration, /Cannot edit a rubric after scoring has begun/);
assert.match(migration, /Every rubric criterion must be scored exactly once/);
assert.match(migration, /Criterion score must be between 0 and %/);
assert.match(migration, /FOR UPDATE/);
assert.match(migration, /phase2_grade_lms_submission\(p_submission_id, v_total, p_feedback\)/);
assert.match(migration, /student_id IN \(SELECT student_id FROM public\.my_linked_student_ids\(\)\)/);
assert.match(migration, /REVOKE ALL ON FUNCTION/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION/);
assert.doesNotMatch(migration, /p_organization_id/);

assert.match(scoreLookupFix, /SELECT COUNT\(\*\) INTO v_matches/);
assert.match(scoreLookupFix, /SELECT item INTO v_score_item/);
assert.match(scoreLookupFix, /LIMIT 1/);
assert.match(scoreLookupFix, /Criterion feedback must be 2,000 characters or fewer/);
assert.doesNotMatch(scoreLookupFix, /MIN\(item\)/);

const submissionMigration = fs.readFileSync(path.join(root, "supabase", "20260922014500_phase2_lms_student_submissions.sql"), "utf8");
const assignmentRoute = fs.readFileSync(path.join(root, "src", "app", "api", "lms", "student-assignments", "route.ts"), "utf8");
const assignmentComponent = fs.readFileSync(path.join(root, "src", "app", "dashboard", "my-courses", "[courseId]", "lessons", "[lessonId]", "_components", "StudentAssignments.tsx"), "utf8");
const lessonLayout = fs.readFileSync(path.join(root, "src", "app", "dashboard", "my-courses", "[courseId]", "lessons", "[lessonId]", "layout.tsx"), "utf8");
assert.match(submissionMigration, /phase2_submit_lms_assignment/);
assert.match(submissionMigration, /phase1_active_role\(\) <> 'student'/);
assert.match(submissionMigration, /s\.profile_id = auth\.uid\(\)/);
assert.match(submissionMigration, /Student is not actively enrolled in this course/);
assert.match(submissionMigration, /A graded submission cannot be changed/);
assert.match(submissionMigration, /FOR UPDATE/);
assert.match(submissionMigration, /Response must be 20,000 characters or fewer/);
assert.match(submissionMigration, /REVOKE ALL ON FUNCTION/);
assert.doesNotMatch(submissionMigration, /p_student_id|p_organization_id/);
assert.match(assignmentRoute, /requireActiveSession/);
assert.match(assignmentRoute, /session\.role !== "student"/);
assert.match(assignmentRoute, /\.eq\("profile_id", session\.user\.id\)/);
assert.match(assignmentRoute, /\.eq\("organization_id", session\.organizationId\)/);
assert.match(assignmentRoute, /phase2_submit_lms_assignment/);
assert.doesNotMatch(assignmentRoute, /guardian_email|SUPABASE_SERVICE_ROLE_KEY/);
assert.match(assignmentComponent, /View rubric/);
assert.match(assignmentComponent, /Update submission/);
assert.match(assignmentComponent, /Assignment submitted/);
assert.match(assignmentComponent, /20,000 characters/);
assert.match(lessonLayout, /<StudentAssignments lessonId=\{lessonId\}/);

console.log("Phase 2 rubric and student assignment-loop integrity contracts passed.");
console.log("Live database tests remain required for RLS personas, submission locking, score boundaries, and concurrency.");
