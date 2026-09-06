import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..", "..");
const migration = fs.readFileSync(
  path.join(root, "supabase", "20260906100000_fix_school_login_after_phase1.sql"),
  "utf8",
);

assert.match(migration, /CREATE OR REPLACE FUNCTION public\.resolve_login_context/);
assert.match(migration, /v_staff_type/);
assert.match(migration, /FROM public\.students[\s\S]*?WHERE profile_id = v_uid/);
assert.match(migration, /parent_profiles pp/);
assert.doesNotMatch(migration, /INSERT INTO public\.org_memberships/);
assert.doesNotMatch(migration, /UPDATE public\.org_memberships/);

console.log("School login context regression contract passed.");
