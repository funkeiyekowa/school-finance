/**
 * Static contract tests for GET /api/attendance/reports
 * Uses tsx + node:assert — no live DB connection.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..", "..", "..", "..", "..");
const routeSrc = fs.readFileSync(
  path.join(root, "src", "app", "api", "attendance", "reports", "route.ts"),
  "utf8"
);

// ------------------------------------------------------------------
// 1. Missing params → 400
// ------------------------------------------------------------------
assert.match(routeSrc, /missing required params/, "Route must return 400 for missing params");
assert.match(routeSrc, /status: 400/, "Route must use 400 status for bad request");
console.log("PASS: missing params → 400");

// ------------------------------------------------------------------
// 2. Unauthenticated → 401
// ------------------------------------------------------------------
assert.match(routeSrc, /auth\.getUser\(\)/, "Route must call auth.getUser()");
assert.match(routeSrc, /status: 401/, "Route must return 401 when not signed in");
console.log("PASS: unauthenticated → 401");

// ------------------------------------------------------------------
// 3. Org isolation — current_user_org_id() called
// ------------------------------------------------------------------
assert.match(routeSrc, /current_user_org_id/, "Route must call current_user_org_id()");
const orgIdx = routeSrc.indexOf("current_user_org_id");
const recordsIdx = routeSrc.indexOf(".from(\"attendance_records\")");
assert.ok(orgIdx < recordsIdx, "org must be resolved before querying attendance_records");
console.log("PASS: org isolation enforced before DB query");

// ------------------------------------------------------------------
// 4. Teacher class scoping — teacher_assignments checked
// ------------------------------------------------------------------
assert.match(routeSrc, /teacher_assignments/, "Route must check teacher_assignments for teachers");
assert.match(routeSrc, /not authorized for this class/, "Route must reject teacher accessing unassigned class");
const teacherCheck = routeSrc.indexOf("teacher_assignments");
const recordsQuery = routeSrc.indexOf("attendance_records");
assert.ok(teacherCheck < recordsQuery, "teacher_assignments check must precede attendance_records query");
console.log("PASS: teacher class scoping enforced before attendance query");

// ------------------------------------------------------------------
// 5. HR/admin/super_admin roles bypass teacher check
// ------------------------------------------------------------------
assert.match(routeSrc, /HR_ACCESS_ROLES/, "Route must define HR_ACCESS_ROLES");
assert.match(routeSrc, /"admin"/, "HR_ACCESS_ROLES must include admin");
assert.match(routeSrc, /"owner"/, "HR_ACCESS_ROLES must include owner");
assert.match(routeSrc, /"super_admin"/, "HR_ACCESS_ROLES must include super_admin");
console.log("PASS: HR_ACCESS_ROLES bypass teacher class gate (admin/owner/super_admin)");

// ------------------------------------------------------------------
// 6. Class must belong to caller's org — no cross-org access
// ------------------------------------------------------------------
const classFromIdx = routeSrc.indexOf('.from("classes")');
assert.ok(classFromIdx !== -1, "Route must query classes table");
// Search for org filter within the 300 chars after .from("classes")
const classQuerySection = routeSrc.slice(classFromIdx, classFromIdx + 300);
assert.match(classQuerySection, /\.eq\("organization_id", orgId\)/, "org check must be part of class query");
console.log("PASS: class org isolation enforced");

// ------------------------------------------------------------------
// 7. attendance_records filtered by org + class + date range
// ------------------------------------------------------------------
assert.match(routeSrc, /\.eq\("organization_id", orgId\)/, "Records must be filtered by orgId");
assert.match(routeSrc, /\.eq\("class_id", class_id\)/, "Records must be filtered by class_id");
assert.match(routeSrc, /\.gte\("date", date_from\)/, "Records must be filtered by date_from");
assert.match(routeSrc, /\.lte\("date", date_to\)/, "Records must be filtered by date_to");
assert.match(routeSrc, /\.is\("subject_id", null\)/, "Records must filter subject_id IS NULL");
console.log("PASS: attendance_records query correctly scoped");

// ------------------------------------------------------------------
// 8. CSV export — no internal UUIDs in output
// ------------------------------------------------------------------
assert.match(routeSrc, /format === "csv"/, "Route must support CSV format");
assert.match(routeSrc, /Content-Disposition/, "CSV response must set Content-Disposition");
assert.match(routeSrc, /student_code/, "CSV must include student_code (not UUID)");
// student_id must NOT appear in the CSV column output
const csvSection = routeSrc.slice(routeSrc.indexOf('format === "csv"'));
assert.doesNotMatch(
  csvSection.slice(0, csvSection.indexOf("return new NextResponse")),
  /student_id.*csv|csv.*student_id/i,
  "student_id (UUID) must not be a CSV column"
);
console.log("PASS: CSV exports student_code (no internal UUIDs)");

// ------------------------------------------------------------------
// 9. Date validation present
// ------------------------------------------------------------------
assert.match(routeSrc, /YYYY-MM-DD|\\d{4}-\\d{2}-\\d{2}/, "Route must validate date format");
assert.match(routeSrc, /date_from > date_to/, "Route must reject inverted date range");
console.log("PASS: date format and range validation present");

// ------------------------------------------------------------------
// 10. phase1_active_role called for role determination
// ------------------------------------------------------------------
assert.match(routeSrc, /phase1_active_role/, "Route must call phase1_active_role");
console.log("PASS: phase1_active_role called for role determination");

// ------------------------------------------------------------------
// 11. SuperAdmin: is_platform_admin() called; class query skips org filter
// ------------------------------------------------------------------
assert.match(routeSrc, /is_platform_admin/, "Route must call is_platform_admin()");
assert.match(routeSrc, /isPlatformAdmin/, "Route must use isPlatformAdmin flag");
// The org filter on classes is conditional on !isPlatformAdmin
assert.match(routeSrc, /if\s*\(!isPlatformAdmin\)/, "Org filter on classes must be conditional for platform admins");
// effectiveOrgId must be derived from class row for platform admins
assert.match(routeSrc, /effectiveOrgId/, "Route must use effectiveOrgId for cross-org platform admin access");
assert.match(routeSrc, /organization_id.*effectiveOrgId|effectiveOrgId.*organization_id/, "Records must be scoped by effectiveOrgId");
console.log("PASS: SuperAdmin bypasses class org filter via is_platform_admin()");

// ------------------------------------------------------------------
// 12. Role authorization matrix encoded correctly in source
// ------------------------------------------------------------------
// super_admin in HR_ACCESS_ROLES → passes role gate
const hrRolesMatch = routeSrc.match(/HR_ACCESS_ROLES\s*=\s*new Set\(\[([^\]]+)\]\)/);
assert.ok(hrRolesMatch, "HR_ACCESS_ROLES set must be parseable");
const hrRoles = hrRolesMatch![1];
assert.ok(hrRoles.includes('"super_admin"'), "super_admin must be in HR_ACCESS_ROLES");
assert.ok(hrRoles.includes('"admin"'), "admin must be in HR_ACCESS_ROLES");
assert.ok(hrRoles.includes('"owner"'), "owner must be in HR_ACCESS_ROLES");
// teacher path — must check teacher_assignments before attendance_records
const teacherGateIdx = routeSrc.indexOf('activeRole === "teacher"');
const recordsQueryIdx = routeSrc.indexOf('.from("attendance_records")');
assert.ok(teacherGateIdx < recordsQueryIdx, "teacher gate must precede attendance_records query");
// unauthorized role — must return 403
assert.match(routeSrc, /status: 403/, "Unauthorized roles must get 403 status");
console.log("PASS: role authorization matrix correct (super_admin/admin/owner=full, teacher=scoped, other=403)");

console.log("\n✓ All attendance reports route contract tests passed.");
