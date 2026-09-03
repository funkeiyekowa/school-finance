-- =====================================================================
-- FIX: force password change for ALL roles, not just students
-- =====================================================================
-- ROOT CAUSE: profiles.must_change_password defaults to FALSE
-- (fix_teacher_login_and_password_change.sql), and every account
-- creation path that inserts a *new* profiles row was setting it TRUE
-- correctly EXCEPT the one trigger that fires for every single
-- auth.users signup: handle_new_user() (schema.sql, trigger
-- on_auth_user_created). It inserts the initial profiles row with no
-- mention of must_change_password at all, so it silently falls back
-- to the column default of FALSE -- for the very first admin account,
-- and for every parent/teacher/staff account that self-provisions by
-- signing in with the shared default password (matched afterwards by
-- trg_new_user_school_binding in school_scoped_login.sql, which also
-- never touches must_change_password).
--
-- Students never had this problem because students.must_change_password
-- has its own column default of TRUE (report_card_and_portals_migration.sql)
-- -- a different table, a different (correct) default.
--
-- This migration:
--   1. Redefines handle_new_user() to set must_change_password = TRUE
--      on every newly inserted profiles row, so the gap is closed at
--      its actual source going forward.
--   2. Backfills every EXISTING profile that is still sitting on the
--      unset default so nobody who already has an account slips
--      through -- scoped to accounts that have never actually signed
--      in yet (last_sign_in_at is null), which covers the reported
--      case (newly created admin/parent/staff) without forcing a
--      change on long-active accounts that already chose their own
--      password before this bug is understood.
--
-- SAFE TO RE-RUN.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  user_count int;
  assigned_role text;
  is_active boolean;
BEGIN
  SELECT count(*) INTO user_count FROM public.profiles;
  IF user_count = 0 THEN
    assigned_role := 'admin';
    is_active := true;
  ELSE
    assigned_role := 'pending';
    is_active := false;
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role, active, must_change_password)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    assigned_role,
    is_active,
    -- Every account in this app is provisioned with the same shared
    -- default password ("ChangeMe123!") until proven otherwise, so the
    -- safe default here is to always require a change on first login.
    TRUE
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------
-- Backfill: accounts that were created but have NEVER signed in yet.
-- These are exactly the "newly created admin/parent/staff" accounts
-- Deji described -- still sitting on the shared default password,
-- just never flagged to force a change. Safe: nobody who is actively
-- using the app with their own chosen password gets interrupted.
-- ---------------------------------------------------------------------
UPDATE public.profiles p
SET must_change_password = TRUE
FROM auth.users u
WHERE u.id = p.id
  AND u.last_sign_in_at IS NULL
  AND p.role <> 'student'
  AND (p.must_change_password IS NULL OR p.must_change_password = FALSE);

-- ---------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------
SELECT 'profiles must_change_password totals' AS metric,
       COUNT(*) FILTER (WHERE must_change_password) AS n_true,
       COUNT(*) FILTER (WHERE NOT must_change_password) AS n_false
FROM public.profiles;

SELECT 'never signed in but not flagged (should be 0 after this runs)' AS metric,
       COUNT(*) AS n
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
WHERE u.last_sign_in_at IS NULL
  AND p.role <> 'student'
  AND (p.must_change_password IS NULL OR p.must_change_password = FALSE);

-- ---------------------------------------------------------------------
-- OPTIONAL, MANUAL, NOT RUN AUTOMATICALLY:
-- If you want to force EVERY existing non-student account to change
-- password on next login regardless of sign-in history (e.g. you
-- suspect some already-active accounts are still on the shared
-- default because they signed in once but dismissed/never saw a
-- change prompt), uncomment and run this separately. This WILL
-- interrupt every admin/parent/staff/teacher currently logged in with
-- a forced password change next time they load the dashboard.
--
-- UPDATE public.profiles SET must_change_password = TRUE WHERE role <> 'student';
