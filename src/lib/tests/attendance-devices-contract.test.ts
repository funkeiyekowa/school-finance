/**
 * Static contract tests for Attendance Phase 4 — device management API.
 * (src/app/api/attendance/devices/route.ts)
 * (src/app/api/attendance/devices/[id]/route.ts)
 * (src/app/dashboard/attendance/devices/page.tsx)
 *
 * These are static source-pattern checks — no live DB or network.
 * They verify that security- and correctness-relevant patterns are
 * present and have not been accidentally removed.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..", "..");

const postRoute = fs.readFileSync(
  path.join(root, "src", "app", "api", "attendance", "devices", "route.ts"),
  "utf8",
);
const patchRoute = fs.readFileSync(
  path.join(root, "src", "app", "api", "attendance", "devices", "[id]", "route.ts"),
  "utf8",
);
const page = fs.readFileSync(
  path.join(root, "src", "app", "dashboard", "attendance", "devices", "page.tsx"),
  "utf8",
);

// ================================================================
// POST route — device registration
// ================================================================

assert.match(postRoute, /auth\.getUser\(\)/, "POST must call auth.getUser() to authenticate the caller");

assert.match(postRoute, /org_memberships/, "POST must resolve org via org_memberships query");
assert.match(postRoute, /is_default.*true|true.*is_default/, "POST must use is_default membership to resolve org");
assert.doesNotMatch(
  postRoute,
  /organization_id.*req\.json|body\.organization_id|organizationId.*body/,
  "POST must NOT accept organization_id from request body",
);

assert.match(postRoute, /ADMIN_ROLES/, "POST must define ADMIN_ROLES for role check");
assert.match(postRoute, /owner.*admin.*super_admin|owner|admin|super_admin/, "POST ADMIN_ROLES must include owner, admin, super_admin");
assert.match(postRoute, /ADMIN_ROLES\.has\(.*role/, "POST must check membership role against ADMIN_ROLES");
assert.match(postRoute, /Only organization admins/, "POST must return 403 for non-admin callers");

assert.match(postRoute, /randomBytes/, "POST must use randomBytes for token generation");
assert.match(postRoute, /createHash.*sha256|sha256.*createHash/, "POST must hash token with SHA-256");
assert.match(postRoute, /randomBytes\(32\)/, "POST must generate 256-bit (32-byte) token");

assert.match(postRoute, /token_hash.*tokenHash|tokenHash.*token_hash/, "POST must store only token_hash in DB");
assert.doesNotMatch(postRoute, /rawToken.*insert|insert.*rawToken/, "POST must NOT insert rawToken into DB");

assert.doesNotMatch(
  postRoute,
  /token_hash.*NextResponse|return.*token_hash/,
  "POST must NOT return token_hash in the response",
);
assert.match(postRoute, /token: rawToken/, "POST must return the plaintext token in the response (shown once)");

assert.match(postRoute, /SUPABASE_SERVICE_ROLE_KEY/, "POST must use service-role key for DB write");
assert.match(postRoute, /persistSession: false/, "POST service client must not persist session");

assert.match(postRoute, /["']qr["']/, "POST must recognise 'qr' as a valid device_type");
assert.match(postRoute, /["']rfid["']/, "POST must recognise 'rfid' as a valid device_type");
assert.doesNotMatch(postRoute, /["']fingerprint["']/, "POST must not invent extra device_type values not in DB");
assert.doesNotMatch(postRoute, /["']facial["']/, "POST must not invent extra device_type values not in DB");

assert.match(postRoute, /from\("classes"\)/, "POST must query classes table to verify class exists");
assert.match(postRoute, /eq\("organization_id".*orgId\)|\.eq\("id".*class_id\)/, "POST must scope class lookup by org or id");

// ================================================================
// PATCH route — update/deactivate
// ================================================================

assert.match(patchRoute, /auth\.getUser\(\)/, "PATCH must call auth.getUser() to authenticate the caller");

assert.match(patchRoute, /org_memberships/, "PATCH must resolve org via org_memberships query");
assert.doesNotMatch(
  patchRoute,
  /organization_id.*req\.json|body\.organization_id/,
  "PATCH must NOT accept organization_id from request body",
);

assert.match(patchRoute, /ADMIN_ROLES/, "PATCH must define ADMIN_ROLES");
assert.match(patchRoute, /ADMIN_ROLES\.has\(.*role/, "PATCH must check role against ADMIN_ROLES");
assert.match(patchRoute, /Only organization admins/, "PATCH must return 403 for non-admin callers");

assert.match(
  patchRoute,
  /attendance_capture_devices[\s\S]{0,200}org_id.*orgId|orgId.*org_id/,
  "PATCH must verify device belongs to caller's org before mutating",
);
assert.match(patchRoute, /Device not found in your organization/, "PATCH must return 404 when device not in caller's org");

assert.doesNotMatch(patchRoute, /\.delete\(\)/, "PATCH must NOT delete devices — use active=false");
assert.match(patchRoute, /active.*false|false.*active/, "PATCH must set active = false for deactivation");

assert.doesNotMatch(
  patchRoute,
  /\.select\(["'][^"']*token_hash/,
  "PATCH must NOT include token_hash in .select() call",
);

assert.match(patchRoute, /SUPABASE_SERVICE_ROLE_KEY/, "PATCH must use service-role key for DB write");

// ================================================================
// Page — admin UI
// ================================================================

assert.match(page, /"use client"/, "page must be a client component");

assert.match(page, /isOrgAdmin/, "page must use isOrgAdmin from useAuth()");
assert.match(page, /!isOrgAdmin/, "page must guard the UI behind !isOrgAdmin check");
assert.match(page, /Only school administrators/, "page must show an admin-only message to non-admins");

assert.doesNotMatch(
  page,
  /\.select\(["'][^"']*token_hash/,
  "page must NOT include token_hash in any .select() call",
);
assert.doesNotMatch(
  page,
  /setState.*token_hash|token_hash.*setState/,
  "page must NOT store token_hash in component state",
);

assert.match(page, /token will not be shown again|will not be shown again/, "page must warn admin that token is shown once");
assert.match(page, /Copy.*[Tt]oken|copy.*token/, "page must offer a copy-token action");

assert.match(page, /\/api\/attendance\/devices\//, "page must call the PATCH device API route for deactivation");
assert.match(page, /active.*false|false.*active/, "page must send active: false for deactivation");
assert.doesNotMatch(page, /\.delete\(\)/, "page must NOT use supabase .delete() directly");

assert.match(page, /["']qr["']/, "page must include 'qr' as a device_type option");
assert.match(page, /["']rfid["']/, "page must include 'rfid' as a device_type option");

assert.doesNotMatch(
  page,
  /\.select\(["'][^"']*\btoken\b/,
  "page device list .select() must not fetch token or token_hash columns",
);

console.log("Attendance devices contract checks passed.");
console.log(
  "Live verification required: admin can register device → gets one-time token; " +
  "non-admin sees guard message; deactivation sets active=false; " +
  "token_hash never appears in responses; PATCH verifies org ownership.",
);
