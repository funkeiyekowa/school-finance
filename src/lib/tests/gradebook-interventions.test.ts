import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..", "..");
const route = fs.readFileSync(path.join(root, "src", "app", "api", "lms", "gradebook", "route.ts"), "utf8");
const page = fs.readFileSync(path.join(root, "src", "app", "dashboard", "teaching", "gradebook", "page.tsx"), "utf8");
const layout = fs.readFileSync(path.join(root, "src", "app", "dashboard", "teaching", "layout.tsx"), "utf8");

assert.match(route, /requireStaffSessionWithOrg/);
assert.match(route, /\.eq\("organization_id", organizationId\)/);
assert.match(route, /lms_submissions/);
assert.match(route, /submission\.status === "graded"/);
assert.match(route, /missing \+= 1/);
assert.match(route, /needsIntervention/);
assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY|p_organization_id/);
assert.match(page, /Authoritative Gradebook/);
assert.match(page, /Intervention flags/);
assert.match(page, /Missing work/);
assert.match(layout, /\/dashboard\/teaching\/gradebook/);

console.log("Authoritative gradebook and intervention-view contracts passed.");
console.log("Live RLS persona and large-course performance tests remain required.");
