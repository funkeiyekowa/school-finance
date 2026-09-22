import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..", "..");
const migration = fs.readFileSync(
  path.join(root, "supabase", "20260922021500_secure_parent_recovery_onboarding.sql"),
  "utf8",
);
const compatibility = fs.readFileSync(
  path.join(root, "supabase", "20260922021600_secure_parent_creation_compat.sql"),
  "utf8",
);

const requiredMigrationContracts = [
  "public._secure_recovery_secret()",
  "extensions.gen_random_bytes(32)",
  "DROP FUNCTION IF EXISTS public.admin_create_parent_user(text)",
  "p_organization_id uuid",
  "p_organization_id IS DISTINCT FROM public.current_user_org_id()",
  "public.is_org_admin(p_organization_id)",
  "public.is_org_admin(v_org)",
  "pp.organization_id = v_org",
  "RETURN 'recovery_required'",
  "u.encrypted_password = extensions.crypt('ChangeMe123!', u.encrypted_password)",
  "Passwords already changed by guardians do not match and remain untouched",
  "REVOKE ALL ON FUNCTION public.admin_reset_parent_password",
  "GRANT EXECUTE ON FUNCTION public.admin_reset_parent_password",
];
for (const contract of requiredMigrationContracts) {
  assert.ok(migration.includes(contract), `missing secure parent contract: ${contract}`);
}

assert.ok(
  !/create_auth_user\([^\n]*'ChangeMe123!'/.test(migration),
  "new parent provisioning must not assign the historical shared password",
);
assert.ok(
  !/encrypted_password\s*=\s*extensions\.crypt\(\s*'ChangeMe123!'/.test(migration),
  "parent reset must not assign the historical shared password",
);

const requiredCompatibilityContracts = [
  "v_org uuid := public.current_user_org_id()",
  "public.is_org_admin(v_org)",
  "public.admin_create_parent_user(p_email, v_org)",
  "REVOKE ALL ON FUNCTION public.admin_create_parent_user(text)",
];
for (const contract of requiredCompatibilityContracts) {
  assert.ok(compatibility.includes(contract), `missing compatibility contract: ${contract}`);
}
assert.ok(!compatibility.includes("ChangeMe123"));

console.log("Secure parent recovery-onboarding database contracts passed.");
console.log("Live tests remain required for recovery email delivery and cross-tenant reset rejection.");
