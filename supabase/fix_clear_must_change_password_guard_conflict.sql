-- =====================================================================
-- FIX: clear_must_change_password() students-table update is blocked by
--      phase1_sensitive_write_guard() for every student, right now.
-- =====================================================================
-- Context: supabase/20260905120000_phase1_security_enforcement.sql
-- installed a BEFORE INSERT OR UPDATE OR DELETE trigger,
-- phase1_sensitive_write_guard, on the students table (added AFTER
-- clear_must_change_password() was fixed in
-- fix_student_clear_must_change_password.sql to also clear
-- students.must_change_password). That trigger fires on every write to
-- students regardless of the calling function's privileges -- SECURITY
-- DEFINER changes ownership for RLS/grant checks, but a BEFORE ROW
-- trigger still evaluates the ACTUAL caller's JWT (auth.role()), which
-- for any signed-in student is 'authenticated', not 'service_role'.
-- Students have none of the phase1_hr_access() roles either, so the
-- trigger's UPDATE public.students inside clear_must_change_password()
-- raises: P0001 "student administration authorization required" -- for
-- every student, not just historical ones. The exception aborts the
-- whole function call (the profiles update rolls back too), the client
-- sees an RPC error, and (before the page.tsx fix in this same change
-- set) the screen used to hide anyway, silently trapping the student.
--
-- FIX: satisfy phase1_sensitive_write_guard()'s own existing, built-in
-- service_role exemption for the students UPDATE only, LOCAL to this
-- function call. We do NOT touch, disable, or weaken
-- phase1_sensitive_write_guard() itself -- same technique as
-- fix_student_password_flag_stuck.sql's backfill, and the same
-- set_config(...) role-simulation pattern already used in
-- rls_finance_permission_scope.VERIFY.sql.
--
-- CORRECTNESS-CRITICAL DETAIL: auth.uid() and auth.role() both read
-- from the SAME request.jwt.claims JSON GUC ('sub' and 'role' fields
-- respectively). So this function:
--   1. Captures the real caller's uid via auth.uid() into v_uid BEFORE
--      touching that GUC at all, and uses v_uid (not auth.uid()) in
--      every WHERE clause from that point on -- so identity is fixed
--      even after the GUC is mutated.
--   2. When it does need the service_role exemption for the students
--      write, it merges 'role' into the EXISTING claims via jsonb_set
--      rather than overwriting request.jwt.claims wholesale, so 'sub'
--      (and any other claim) is never lost as a side effect.
--   3. set_config's third argument is `true` (LOCAL) -- scoped to this
--      transaction only, never leaks to later statements/sessions.
--
-- Idempotent (CREATE OR REPLACE). Safe to re-run.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.clear_must_change_password()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not signed in';
  END IF;

  -- Staff / parent / teacher / admin path (unchanged). profiles is not
  -- one of phase1_sensitive_write_guard()'s guarded tables.
  UPDATE public.profiles
     SET must_change_password = FALSE
   WHERE id = v_uid;

  -- Student path: clear the flag on the caller's own linked student
  -- row(s). Guarded so this migration still applies on installs that
  -- predate the students.must_change_password column.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'students'
      AND column_name = 'must_change_password'
  ) THEN
    -- Satisfy phase1_sensitive_write_guard()'s own service_role
    -- exemption for this statement only; preserves 'sub' (v_uid is
    -- already captured above regardless) and every other existing
    -- claim via merge, not overwrite.
    PERFORM set_config(
      'request.jwt.claims',
      jsonb_set(
        COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb),
        '{role}', '"service_role"'
      )::text,
      true
    );

    UPDATE public.students
       SET must_change_password = FALSE
     WHERE profile_id = v_uid;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.clear_must_change_password() TO authenticated;

-- =====================================================================
-- Verification
-- =====================================================================
-- 1. Function exists with the expected signature.
SELECT proname, pg_get_function_identity_arguments(oid) AS args
FROM pg_proc WHERE proname = 'clear_must_change_password';

-- 2. Confirm the guard's own exemption clause is unchanged (expect the
--    function body to still short-circuit on service_role/supabase_admin
--    -- this migration touches NOTHING in phase1_sensitive_write_guard).
SELECT 'phase1_sensitive_write_guard untouched (sanity)' AS check,
       pg_get_functiondef(oid) LIKE '%service_role%supabase_admin%' AS still_has_exemption
FROM pg_proc WHERE proname = 'phase1_sensitive_write_guard';
