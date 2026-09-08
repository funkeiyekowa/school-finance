/**
 * Static contract tests for GET /api/attendance/subjects
 * Phase 8 — subject-level attendance authorization scoping
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..", "..", "..", "..", "..");
const routeSrc = fs.readFileSync(
  path.join(root, "src", "app", "api", "attendance", "subjects", "route.ts"),
  "utf8"
);

// 1. Missing class_id → 400
assert.match(routeSrc, /missing required param.*class_id/, "Must return 400 for missing class_id");
assert.match(routeSrc, /status: 400/, "Must use 400 status");
console.log("PASS: missing class_id → 400");

// 2. Unauthenticated → 401
assert.match(routeSrc, /auth\.getUser\(\)/, "Must call auth.getUser()");
assert.match(routeSrc, /status: 401/, "Must return 401");
console.log("PASS: unauthenticated → 401");

// 3. Org resolved server-side
assert.match(routeSrc, /current_user_org_id/, "Must call current_user_org_id()");
const orgIdx = routeSrc.indexOf("current_user_org_id");
const subjectsIdx = routeSrc.indexOf('.from("subjects")');
assert.ok(orgIdx < subjectsIdx, "Org must be resolved before querying subjects");
console.log("PASS: org resolved before subjects query");

// 4. SuperAdmin: is_platform_admin() called, class org used
assert.match(routeSrc, /is_platform_admin/, "Must call is_platform_admin()");
assert.match(routeSrc, /effectiveOrgId/, "Must use effectiveOrgId for platform admin");
console.log("PASS: SuperAdmin cross-org access via is_platform_admin()");

// 5. phase1_active_role called
assert.match(routeSrc, /phase1_active_role/, "Must call phase1_active_role");
console.log("PASS: phase1_active_role called");

// 6. HR_ACCESS_ROLES includes super_admin
const hrMatch = routeSrc.match(/HR_ACCESS_ROLES\s*=\s*new Set\(\[([^\]]+)\]\)/);
assert.ok(hrMatch, "HR_ACCESS_ROLES must be defined");
const hrRoles = hrMatch![1];
assert.ok(hrRoles.includes('"super_admin"'), "super_admin must be in HR_ACCESS_ROLES");
assert.ok(hrRoles.includes('"admin"'), "admin must be in HR_ACCESS_ROLES");
assert.ok(hrRoles.includes('"owner"'), "owner must be in HR_ACCESS_ROLES");
console.log("PASS: HR_ACCESS_ROLES includes super_admin, admin, owner");

// 7. Teacher must be assigned to class before seeing subjects
assert.match(routeSrc, /teacher_assignments/, "Must check teacher_assignments for teachers");
assert.match(routeSrc, /not authorized for this class/, "Must reject teacher not assigned to class");
const teacherCheckIdx = routeSrc.indexOf("teacher_assignments");
assert.ok(teacherCheckIdx < subjectsIdx, "teacher_assignments check must precede subjects query");
console.log("PASS: teacher must be assigned to class");

// 8. Class teacher (subject_id IS NULL in assignment) sees all subjects
assert.match(routeSrc, /subject_id.*null|isClassTeacher/, "Must handle class-teacher (null subject) assignment");
assert.match(routeSrc, /isClassTeacher/, "Must track isClassTeacher flag");
console.log("PASS: class teacher (null subject assignment) sees all subjects");

// 9. Subject teacher sees only their assigned subjects
assert.match(routeSrc, /\.in\("id",\s*subjectIds\)/, "Subject teacher must be filtered to their subjects");
console.log("PASS: subject teacher sees only assigned subjects");

// 10. Subjects filtered by active=true and org
assert.match(routeSrc, /\.eq\("active", true\)/, "Subjects must be filtered by active=true");
assert.match(routeSrc, /\.eq\("organization_id", effectiveOrgId\)/, "Subjects must be scoped to org");
console.log("PASS: subjects filtered by active=true and org");

console.log("\n✓ All attendance subjects route contract tests passed.");
