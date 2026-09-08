/**
 * Static contract tests for POST /api/attendance/rfid-ingest
 * Uses tsx + node:assert — no live DB connection.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..", "..", "..", "..", "..");
const routeSrc = fs.readFileSync(
  path.join(root, "src", "app", "api", "attendance", "rfid-ingest", "route.ts"),
  "utf8"
);

// ------------------------------------------------------------------
// 1. Missing token → 401
// ------------------------------------------------------------------
assert.match(routeSrc, /status: 401/, "Route must return 401 for missing token");
assert.match(routeSrc, /missing or invalid device token/, "Route must emit missing token message");
console.log("PASS: missing token → 401");

// ------------------------------------------------------------------
// 2. Token is SHA-256 hashed — plaintext never reaches DB
// ------------------------------------------------------------------
assert.match(routeSrc, /createHash\("sha256"\)/, "Route must hash the token with SHA-256");
assert.doesNotMatch(routeSrc, /p_token_hash.*rawToken/, "Plaintext token must not reach DB RPC");
const hashAssignment = routeSrc.match(/const tokenHash = createHash.*\.digest\("hex"\)/);
assert.ok(hashAssignment, "tokenHash must be defined before any DB call");
const tokenHashIdx = routeSrc.indexOf("const tokenHash");
const dbCallIdx = routeSrc.indexOf("from(\"attendance_capture_devices\")");
assert.ok(tokenHashIdx < dbCallIdx, "tokenHash must be computed before DB lookup");
console.log("PASS: token SHA-256 hashed before DB lookup");

// ------------------------------------------------------------------
// 3. Non-RFID device → 403
// ------------------------------------------------------------------
assert.match(routeSrc, /device_type !== "rfid"/, "Route must reject non-RFID devices");
assert.match(routeSrc, /status: 403/, "Route must return 403 for non-RFID device");
console.log("PASS: non-RFID device → 403");

// ------------------------------------------------------------------
// 4. Minimum card UID length enforced (≥ 4 chars)
// ------------------------------------------------------------------
assert.match(routeSrc, /card_uid.*length < 4|length.*< 4.*card_uid/, "Route must enforce min UID length of 4");
console.log("PASS: card UID minimum length enforced");

// ------------------------------------------------------------------
// 5. Unknown card UID → 404 path
// ------------------------------------------------------------------
assert.match(routeSrc, /resolve_rfid_card/, "Route must call resolve_rfid_card RPC");
assert.match(routeSrc, /not recognised or inactive/, "Route must handle unrecognised UID error");
// 404 is returned via httpStatusForDbError("not recognised or inactive") === 404
assert.match(routeSrc, /return 404/, "httpStatusForDbError must map unrecognised card to 404");
console.log("PASS: unknown card UID → 404 path");

// ------------------------------------------------------------------
// 6. Resolved student ID passed to ingest — not the card UID
// ------------------------------------------------------------------
assert.match(routeSrc, /ingest_attendance_from_device/, "Route must call ingest_attendance_from_device");
const ingestCallIdx = routeSrc.indexOf("ingest_attendance_from_device");
const studentIdUsage = routeSrc.slice(ingestCallIdx).indexOf("studentId");
assert.ok(studentIdUsage !== -1, "ingest_attendance_from_device must receive studentId (not card UID)");
assert.doesNotMatch(
  routeSrc.slice(ingestCallIdx, ingestCallIdx + 300),
  /card_uid/,
  "card_uid must not be passed directly to ingest_attendance_from_device"
);
console.log("PASS: resolved student_id (not card_uid) passed to ingest RPC");

// ------------------------------------------------------------------
// 7. student_name returned in success response
// ------------------------------------------------------------------
assert.match(routeSrc, /student_name/, "Route must return student_name in response");
assert.match(routeSrc, /success: true/, "Route must return success:true on 200");
console.log("PASS: student_name returned in 200 response");

// ------------------------------------------------------------------
// 8. Service-role client used — bypasses RLS for card resolution
// ------------------------------------------------------------------
assert.match(routeSrc, /makeServiceClient/, "Route must use service-role client");
assert.doesNotMatch(routeSrc, /createBrowserClient|createClientComponentClient/, "Route must not use browser client");
console.log("PASS: service-role client used (no browser client)");

// ------------------------------------------------------------------
// 9. UID normalised to uppercase before lookup
// ------------------------------------------------------------------
assert.match(routeSrc, /toUpperCase\(\)|\.toUpperCase/, "Route must normalise card UID to uppercase");
console.log("PASS: card UID normalised to uppercase");

// ------------------------------------------------------------------
// 10. Card status_code defaults to 'present'
// ------------------------------------------------------------------
assert.match(routeSrc, /status_code = "present"/, "Route must default status_code to 'present'");
console.log("PASS: status_code defaults to 'present'");

console.log("\n✓ All rfid-ingest route contract tests passed.");
