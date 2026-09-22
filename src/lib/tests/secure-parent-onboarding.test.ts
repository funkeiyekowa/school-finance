import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..", "..");
const migration = fs.readFileSync(
  path.join(root, "supabase", "20260922021500_secure_parent_recovery_onboarding.sql"),
  "utf8",
);

assert.match(migration, /_secure_recovery_secret/);
assert.match(migration, /extensions\.gen_random_bytes\(32\)/);
assert.match(migration, /DROP FUNCTION IF EXISTS public\.admin_create_parent_user\(text\)/);
assert.match(migration, /admin_create_parent_user\(\s*p_email text,\s*p_organization_id uuid/);
assert.match(migration, /p_organization_id IS DISTINCT FROM public\.current_user_org_id\(\)/);
assert.match(migration, /public\.is_org_admin\(p_organization_id\)/);
assert.match(migration, /public\.is_org_admin\(v_org\)/);
assert.match(migration, /pp\.organization_id = v_org/);
assert.match(migration, /RETURN 'recovery_required'/);
assert.match(migration, /u\.encrypted_password = extensions\.crypt\('ChangeMe123!', u\.encrypted_password\)/);
assert.match(migration, /Passwords already changed by guardians do not match and remain untouched/);
assert.doesNotMatch(migration, /create_auth_user\([^\n]*'ChangeMe123!'/);
assert.doesNotMatch(migration, /encrypted_password\s*=\s*extensions\.crypt\(\s*'ChangeMe123!'/);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.admin_reset_parent_password/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.admin_reset_parent_password/);

console.log("Secure parent recovery-onboarding database contracts passed.");
console.log("Live tests remain required for recovery email delivery and cross-tenant reset rejection.");
