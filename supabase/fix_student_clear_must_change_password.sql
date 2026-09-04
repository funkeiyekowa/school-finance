-- ============================================================
-- FIX: student "Set Your New Password" screen never dismisses
-- ============================================================
-- Run order: after fix_teacher_login_and_password_change.sql (#47, which
--   created clear_must_change_password) and report_card_and_portals_migration.sql
--   (#35, which added students.must_change_password). Idempotent — safe to
--   re-run. No data destroyed; only replaces one function.
--
-- ROOT CAUSE
-- ----------
-- The student portal reads students.must_change_password to decide whether
-- to show the "Set Your New Password" screen. On submit it did a direct
-- `UPDATE students SET must_change_password = false`, but a student has NO
-- write policy on the students table (RLS: students_staff_all is staff-only,
-- plus students_self_read for SELECT). So the flag never cleared, the page
-- re-read it as TRUE, and the student was bounced back to the password
-- screen forever.
--
-- The staff/parent flow avoids this by calling the SECURITY DEFINER RPC
-- clear_must_change_password(), but that RPC only cleared profiles — never
-- students. This migration extends it to ALSO clear the caller's own
-- students row(s), so the same RPC works for every role.
--
-- SECURITY: SECURITY DEFINER, but strictly scoped to the caller
-- (auth.uid()) — it can only clear the flag on the row(s) that belong to
-- the signed-in user, never anyone else's. It does not weaken the table's
-- RLS for any other operation.

CREATE OR REPLACE FUNCTION public.clear_must_change_password()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not signed in';
  END IF;

  -- Staff / parent / teacher / admin path (unchanged).
  UPDATE public.profiles
     SET must_change_password = FALSE
   WHERE id = auth.uid();

  -- Student path: clear the flag on the caller's own linked student row(s).
  -- Guarded so this migration still applies on installs that predate the
  -- students.must_change_password column.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'students'
      AND column_name = 'must_change_password'
  ) THEN
    UPDATE public.students
       SET must_change_password = FALSE
     WHERE profile_id = auth.uid();
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.clear_must_change_password() TO authenticated;

-- ============================================================
-- Verification
-- ============================================================
-- 1. Function exists with the expected signature.
SELECT proname, pg_get_function_identity_arguments(oid) AS args
FROM pg_proc WHERE proname = 'clear_must_change_password';

-- 2. After a student signs in and completes the password change, this
--    should show 0 for that student (run as a check, replacing the id):
--    SELECT id, full_name, must_change_password FROM students WHERE profile_id = '<student_auth_uid>';
--
-- 3. Aggregate sanity: how many students still flagged.
SELECT 'students must_change_password totals' AS metric,
       COUNT(*) FILTER (WHERE must_change_password) AS n_true,
       COUNT(*) FILTER (WHERE NOT must_change_password) AS n_false
  FROM public.students;
