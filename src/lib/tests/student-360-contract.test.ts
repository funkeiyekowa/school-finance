import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..", "..");
const route = fs.readFileSync(
  path.join(root, "src", "app", "api", "students", "360", "route.ts"),
  "utf8",
);
const layout = fs.readFileSync(
  path.join(root, "src", "app", "dashboard", "students", "[id]", "layout.tsx"),
  "utf8",
);
const header = fs.readFileSync(
  path.join(root, "src", "app", "dashboard", "students", "[id]", "_components", "Student360Header.tsx"),
  "utf8",
);

assert.match(route, /requireStaffSessionWithOrg\(\{ permission: "students" \}\)/);
assert.match(route, /\.eq\("organization_id", organizationId\)/);
assert.match(route, /\.eq\("id", studentId\)/);
assert.match(route, /\.eq\("student_id", studentId\)/);
assert.match(route, /A valid student_id is required/);
assert.match(route, /Student not found/);
assert.match(route, /unavailableSections/);
assert.match(route, /lookbackDays/);
assert.match(route, /subjectPerformance/);

// Sensitive domains must never be added to this broad summary contract.
for (const forbidden of [
  "guardian_email",
  "guardian_phone",
  "address",
  "date_of_birth",
  "medical_records",
  "clinic_visits",
  "safeguarding",
]) {
  assert.doesNotMatch(route, new RegExp(`select\\([^)]*${forbidden}`), `broad Student 360 query exposes ${forbidden}`);
}

// The endpoint must not use a service-role client or trust an org supplied by the browser.
assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY/);
assert.doesNotMatch(route, /searchParams\.get\(["']organization_id/);

// The UI is additive around the existing page, does not wrap printable child routes,
// and makes loading, retry, partial-data and empty-data states explicit.
assert.match(layout, /<Student360Header studentId=\{id\}/);
assert.match(layout, /\{children\}/);
assert.match(header, /pathname\.replace\(\/\\\/$\/,[^)]*\) === expectedPath/);
assert.match(header, /\/api\/students\/360\?student_id=/);
assert.match(header, /cache: "no-store"/);
assert.match(header, /Retry/);
assert.match(header, /summary\.partial/);
assert.match(header, /No attendance sessions recorded/);
assert.match(header, /No assessment scores recorded/);
assert.match(header, /Role-aware, field-minimized summary/);
assert.doesNotMatch(header, /guardian_email|guardian_phone|date_of_birth|medical_records|safeguarding/);

console.log("Student 360 contract checks passed: tenant scope, field minimization, partial-data behavior, and additive UI are present.");
console.log("Live Supabase persona and cross-tenant tests remain required before production sign-off.");
