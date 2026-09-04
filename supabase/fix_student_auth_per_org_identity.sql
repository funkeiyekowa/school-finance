-- =====================================================================
-- TENANT-ISOLATED STUDENT AUTH IDENTITY
-- =====================================================================
-- Problem (confirmed by read-only dry run on production):
--   Student login identities were derived GLOBALLY as
--     lower(student_code) || '@student.local'
--   Because auth emails are globally unique and create_auth_user() is
--   idempotent-by-email, two schools that both use e.g. S123 would be
--   bound to ONE auth account -> shared password/session/reset. This
--   silently defeats the per-org uniqueness of student_code.
--
-- Fix (this file — SQL side, safe to apply; changes NO existing rows):
--   1. Redefine auto_provision_student() so NEW students get a
--      TENANT-SCOPED synthetic identity:
--        lower(student_code) || '.' || organization_id || '@student.local'
--      Fail closed if organization_id is NULL (never mint a global email).
--   2. Redefine verify_student_code() to REQUIRE authoritative org
--      context (p_org). No LIMIT 1 ambiguity. The effective lookup is
--        organization_id + student_code -> exactly one student.
--      A legacy code-only overload is REMOVED so nothing can resolve a
--      code without a tenant.
--
-- What this file does NOT do (handled separately, see
--   scripts/migrate-student-auth-identity.mjs — Supabase Admin API):
--   * It does NOT rename any existing auth.users email.
--   * It does NOT touch auth.identities.
--   * It does NOT change passwords, sessions, student_code, or
--     profile ownership.
--   Existing @student.local accounts keep working until the Admin-API
--   backfill is run manually. New students created after this migration
--   are already tenant-isolated.
--
-- Business IDs (student_code/staff_code/vendor_code) are NEVER changed.
-- RLS is NOT weakened. Idempotent. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Canonical helper: derive the tenant-scoped synthetic student email.
-- Single source of truth so the trigger, the Admin-API backfill, and
-- verify_student_code() all agree byte-for-byte.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_auth_email(p_code text, p_org uuid)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT lower(btrim(p_code)) || '.' || p_org::text || '@student.local';
$$;

COMMENT ON FUNCTION public.student_auth_email(text, uuid) IS
  'Canonical tenant-scoped synthetic student login email: <lower(code)>.<org_id>@student.local. Business student_code is never altered.';


-- ---------------------------------------------------------------------
-- 1. auto_provision_student() — tenant-scoped identity, fail closed.
--    Authoritative redefinition (supersedes the copies in
--    student_visibility_fixes.sql / fix_auto_role_assignment.sql /
--    fix_auto_approve_users.sql / auto_provision_users.sql).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_provision_student()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid   UUID;
  v_email TEXT;
BEGIN
  IF NEW.profile_id IS NULL
     AND NEW.student_code IS NOT NULL
     AND btrim(NEW.student_code) <> ''
     AND NEW.status = 'active' THEN

    -- FAIL CLOSED: never mint a globally-shared identity. A student with
    -- no organization_id must not be auto-provisioned; the app always
    -- stamps organization_id on insert.
    IF NEW.organization_id IS NULL THEN
      RAISE EXCEPTION
        'auto_provision_student: organization_id is required to create a tenant-scoped login for student_code %',
        NEW.student_code
        USING ERRCODE = 'check_violation';
    END IF;

    -- Tenant-scoped synthetic email. create_auth_user() is idempotent by
    -- email; because the org id is part of the email, two schools using
    -- the same student_code get DISTINCT auth users.
    v_email := public.student_auth_email(NEW.student_code, NEW.organization_id);
    v_uid := public.create_auth_user(v_email, 'ChangeMe123!', 'student');

    NEW.profile_id := v_uid;
    NEW.login_enabled := TRUE;
    NEW.must_change_password := TRUE;

    INSERT INTO public.profiles (id, email, full_name, role, active, organization_id)
    VALUES (v_uid, v_email, NEW.full_name, 'student', TRUE, NEW.organization_id)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.org_memberships (user_id, organization_id, role, is_default, active)
    VALUES (v_uid, NEW.organization_id, 'student', TRUE, TRUE)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_auto_provision_student ON public.students;
CREATE TRIGGER trg_auto_provision_student
  BEFORE INSERT ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.auto_provision_student();


-- ---------------------------------------------------------------------
-- 2. verify_student_code() — REQUIRES authoritative org context.
--    Effective lookup: organization_id + student_code -> exactly one.
--    No LIMIT 1 ambiguity: if >1 row somehow matches (should be
--    impossible under the per-org unique constraint) we FAIL CLOSED.
-- ---------------------------------------------------------------------

-- Remove the dangerous code-only overload so nothing can resolve a
-- student_code without a tenant. (No-op if it was never created.)
DROP FUNCTION IF EXISTS public.verify_student_code(text);

-- Org-by-id form.
CREATE OR REPLACE FUNCTION public.verify_student_code(p_code text, p_org uuid)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_count int;
  v_student RECORD;
BEGIN
  IF p_code IS NULL OR btrim(p_code) = '' OR p_org IS NULL THEN
    RETURN jsonb_build_object('exists', false, 'active', false);
  END IF;

  SELECT count(*) INTO v_count
  FROM public.students
  WHERE organization_id = p_org
    AND UPPER(btrim(student_code)) = UPPER(btrim(p_code));

  -- Per-org uniqueness should make this 0 or 1. Anything else is an
  -- integrity anomaly -> fail closed, never guess.
  IF v_count > 1 THEN
    RETURN jsonb_build_object('exists', false, 'active', false, 'error', 'ambiguous');
  END IF;

  IF v_count = 0 THEN
    RETURN jsonb_build_object('exists', false, 'active', false);
  END IF;

  SELECT id, student_code, status, profile_id, organization_id
    INTO v_student
  FROM public.students
  WHERE organization_id = p_org
    AND UPPER(btrim(student_code)) = UPPER(btrim(p_code));

  RETURN jsonb_build_object(
    'exists', true,
    'active', v_student.status = 'active',
    'login_email', public.student_auth_email(v_student.student_code, v_student.organization_id),
    'has_auth', v_student.profile_id IS NOT NULL
  );
END;
$$;

-- Convenience org-by-slug form for the public login page (slug -> org id,
-- then delegates). Slug is used only to RESOLVE the org at call time; it is
-- NOT the permanent auth discriminator (that is organization_id).
CREATE OR REPLACE FUNCTION public.verify_student_code_by_slug(p_code text, p_slug text)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org uuid;
BEGIN
  IF p_slug IS NULL OR btrim(p_slug) = '' THEN
    RETURN jsonb_build_object('exists', false, 'active', false);
  END IF;

  SELECT id INTO v_org FROM public.organizations WHERE slug = lower(btrim(p_slug));
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('exists', false, 'active', false, 'error', 'unknown_school');
  END IF;

  RETURN public.verify_student_code(p_code, v_org);
END;
$$;

REVOKE ALL ON FUNCTION public.verify_student_code(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.verify_student_code(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_student_code_by_slug(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.student_auth_email(text, uuid) TO anon, authenticated;


-- =====================================================================
-- VERIFICATION (read-only) — run after applying.
-- =====================================================================

-- V1. The canonical email helper is tenant-scoped (two orgs, same code
--     -> different emails).
SELECT 'V1 helper distinct per org' AS check,
       public.student_auth_email('S123', '00000000-0000-0000-0000-000000000001') AS org1,
       public.student_auth_email('S123', '00000000-0000-0000-0000-000000000002') AS org2;

-- V2. The dangerous code-only overload is gone (expect 0 rows).
SELECT 'V2 code-only verify_student_code removed' AS check, count(*) AS remaining
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'verify_student_code'
  AND pg_get_function_identity_arguments(p.oid) = 'text';

-- V3. The org-scoped forms exist (expect 2: (text,uuid) and (text,text)).
SELECT 'V3 org-scoped verify forms' AS check, count(*) AS n
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('verify_student_code','verify_student_code_by_slug')
  AND pg_get_function_identity_arguments(p.oid) IN ('text, uuid','text, text');

-- V4. auto_provision_student trigger is present and BEFORE INSERT.
SELECT 'V4 trigger present' AS check, tgname, tgenabled
FROM pg_trigger WHERE tgname = 'trg_auto_provision_student';

-- V5. No two students in the SAME org share a student_code (per-org
--     uniqueness holds; expect 0 rows).
SELECT 'V5 dup (org,code)' AS check, organization_id, upper(btrim(student_code)) AS code, count(*)
FROM public.students
WHERE student_code IS NOT NULL AND btrim(student_code) <> ''
GROUP BY organization_id, upper(btrim(student_code))
HAVING count(*) > 1;

-- V6. Existing cross-tenant shared auth uids among students (diagnostic;
--     the Admin-API backfill addresses these; expect the known count).
SELECT 'V6 shared profile_id across orgs' AS check, profile_id, count(DISTINCT organization_id) AS orgs
FROM public.students
WHERE profile_id IS NOT NULL
GROUP BY profile_id
HAVING count(DISTINCT organization_id) > 1;
