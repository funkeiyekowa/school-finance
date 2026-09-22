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
assert.match(scoreLookupFix, /phase2_grade_lms_submission\(p_submission_id, v_total, p_feedback\)/);

const rubricRoute = fs.readFileSync(path.join(root, "src", "app", "api", "lms", "rubrics", "route.ts"), "utf8");
const rubricPage = fs.readFileSync(path.join(root, "src", "app", "dashboard", "teaching", "rubrics", "page.tsx"), "utf8");
const teachingLayout = fs.readFileSync(path.join(root, "src", "app", "dashboard", "teaching", "layout.tsx"), "utf8");
assert.match(rubricRoute, /requireStaffSessionWithOrg/);
assert.match(rubricRoute, /\.eq\("organization_id", organizationId\)/);
assert.match(rubricRoute, /phase2_save_assignment_rubric/);
assert.match(rubricRoute, /A rubric requires 1 to 20 criteria/);
assert.match(rubricRoute, /Criterion descriptions must be 2,000 characters or fewer/);
assert.doesNotMatch(rubricRoute, /SUPABASE_SERVICE_ROLE_KEY|p_organization_id/);
assert.match(rubricPage, /Criterion maximums must total exactly/);
assert.match(rubricPage, /This rubric is locked because scoring has begun/);
assert.match(rubricPage, /Students will see it with the assignment/);
assert.match(rubricPage, /Create an LMS assignment before building a rubric/);
assert.match(teachingLayout, /\/dashboard\/teaching\/rubrics/);

console.log("Phase 2 rubric authorization, portable score lookup, scoring-integrity, and Rubric Studio contracts passed.");
console.log("Live database tests remain required for RLS personas, score boundaries, and concurrent grading.");
