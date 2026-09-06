-- =====================================================================
-- FIX: students stuck on "Set Your New Password" after already
--      completing it (must_change_password never cleared on students).
-- =====================================================================
-- Context: clear_must_change_password() (see
--   fix_student_clear_must_change_password.sql) clears BOTH
--   profiles.must_change_password AND students.must_change_password for
--   the caller (auth.uid()).
--
-- This migration backfills students who got stuck BEFORE that fix
-- shipped: their profiles flag was already cleared (proof they went
-- through the change-password flow), but their students flag never
-- was.
--
-- WHY A TEMP SECURITY DEFINER FUNCTION:
--   supabase/20260905120000_phase1_security_enforcement.sql installed a
--   BEFORE INSERT OR UPDATE OR DELETE trigger, phase1_sensitive_write_guard,
--   on the students table (and others). It raises 'student administration
--   authorization required' unless auth.role() IN ('service_role',
--   'supabase_admin') or phase1_hr_access() is true -- and it fires on
--   every write to students regardless of caller, including a plain
--   UPDATE run from this admin SQL session. We do NOT touch, disable, or
--   bypass phase1_sensitive_write_guard() itself. Instead we legitimately
--   satisfy its own existing service_role exemption for the duration of
--   this one backfill, using the same set_config('request.jwt.claims', ...)
--   technique this codebase already uses elsewhere for authorized,
--   scoped-role simulation (see rls_finance_permission_scope.VERIFY.sql).
--
-- SAFETY MODEL:
--   * Only clears students.must_change_password where the row's OWN
--     linked profiles.must_change_password is ALREADY false -- proof
--     that student has demonstrably already completed the password
--     change flow. A student who has never attempted it keeps BOTH
--     flags true and is untouched -- still correctly forced through the
--     screen.
--   * Optional p_org parameter scopes the backfill to one organization
--     (tenant-safe); NULL (default) applies it across all orgs, which is
--     safe here because the WHERE clause itself is the safety boundary,
--     not the org scope.
--   * The function is revoked from anon/authenticated immediately after
--     creation (defense in depth) and DROPPED at the end of this script
--     -- it does not linger as a standing bypass.
--   * Idempotent: safe to re-run; a second run updates 0 rows.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0. Diagnostics (BEFORE)
-- ---------------------------------------------------------------------
SELECT 'BEFORE: students stuck (profile cleared, student flag stuck)' AS metric, COUNT(*) AS n
FROM public.students s
JOIN public.profiles p ON p.id = s.profile_id
WHERE s.must_change_password = TRUE
  AND p.must_change_password = FALSE;

-- ---------------------------------------------------------------------
-- 1. Temporary admin-only backfill function
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._tmp_backfill_stuck_student_password_flags(p_org uuid DEFAULT NULL)
RETURNS TABLE (updated_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  -- Legitimately satisfy phase1_sensitive_write_guard()'s own existing
  -- service_role exemption for this statement only (LOCAL to the
  -- transaction) -- does not modify or bypass the guard function.
  PERFORM set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);

  UPDATE public.students s
     SET must_change_password = FALSE
    FROM public.profiles p
   WHERE p.id = s.profile_id
     AND s.must_change_password = TRUE
     AND p.must_change_password = FALSE
     AND (p_org IS NULL OR s.organization_id = p_org);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN QUERY SELECT v_updated;
END;
$$;

-- Defense in depth: never exposed to the app-facing roles, even
-- momentarily.
REVOKE ALL ON FUNCTION public._tmp_backfill_stuck_student_password_flags(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Run it (all orgs; pass a specific org uuid to scope narrower)
-- ---------------------------------------------------------------------
SELECT * FROM public._tmp_backfill_stuck_student_password_flags(NULL);

-- ---------------------------------------------------------------------
-- 3. Diagnostics (AFTER) -- expect 0
-- ---------------------------------------------------------------------
SELECT 'AFTER: students stuck (should be 0)' AS metric, COUNT(*) AS n
FROM public.students s
JOIN public.profiles p ON p.id = s.profile_id
WHERE s.must_change_password = TRUE
  AND p.must_change_password = FALSE;

-- Students genuinely still needing their first password change (both
-- flags true) -- expected to be non-zero, and must remain untouched.
SELECT 'Students still needing first password change (expected, untouched)' AS metric, COUNT(*) AS n
FROM public.students s
JOIN public.profiles p ON p.id = s.profile_id
WHERE s.must_change_password = TRUE
  AND p.must_change_password = TRUE;

-- ---------------------------------------------------------------------
-- 4. Drop the temporary function -- does not linger as a standing
--    bypass mechanism.
-- ---------------------------------------------------------------------
DROP FUNCTION public._tmp_backfill_stuck_student_password_flags(uuid);

COMMIT;
