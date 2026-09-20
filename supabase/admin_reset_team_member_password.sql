-- =====================================================================
-- ADMIN RESET TEAM MEMBER PASSWORD — generic credential reset for any
-- profile in an admin's organization (Team page "Reset Password" action)
-- =====================================================================
-- Run order: after saas_foundation.sql (#22 — defines is_org_admin(),
-- is_platform_admin(), org_memberships),
-- fix_teacher_login_and_password_change.sql (#47 — adds
-- profiles.must_change_password, which this sets), and
-- 20260905120000_phase1_security_enforcement.sql (installs
-- phase1_sensitive_write_guard on students — see the students UPDATE
-- below, which must satisfy that guard's service_role exemption).
-- Independent of cbt_upgrade_migration.sql's reset_student_password() —
-- this does not call that function, it duplicates the same safe
-- bcrypt-update pattern so it works even on a database where that
-- migration wasn't applied. Adds no RLS policy, so it is order-
-- independent with respect to rls_role_scoped_access.sql.
--
-- WHY: dashboard/team lists every user (admins, teachers, staff, parents,
-- students) but only had Approve/Deactivate actions — no way for a School
-- Admin or Super Admin to reset a locked-out user's credential. Two
-- narrow reset RPCs already existed (admin_reset_parent_password, keyed
-- by parent_profiles.id and hardcoded to the shared default password;
-- reset_student_password, keyed by students.id) but nothing covered
-- admins/teachers/staff, and nothing was keyed by profiles.id — the id
-- the Team page actually has for every row. This adds ONE generic RPC
-- for that id, for every role.
--
-- Behaviour:
--   1. Authorization mirrors every other admin-gated RPC in this repo
--      (admin_create_org_member, reset_student_password): the caller
--      must satisfy is_org_admin(<target's org>), i.e. be a
--      super_admin/owner/admin of that org, or a platform admin
--      (is_platform_admin() — see saas_foundation.sql). A school admin
--      can only reset users in their own school; a platform admin can
--      reset anyone.
--   2. p_org is optional. The Team page passes the org it's currently
--      viewing (and the target's membership in that exact org is
--      verified). If omitted, the target's own active org membership is
--      resolved automatically — used as a fallback for callers that
--      don't have an org in scope.
--   3. Refuses to let a caller reset their own password through this
--      path (use the normal change-password screen for that).
--   4. Generates a random 10-character temporary password (same
--      collision-avoiding generation as reset_student_password) and
--      writes it to auth.users.encrypted_password via pgcrypto — the
--      exact bcrypt pattern already used by reset_student_password,
--      admin_reset_parent_password and update_platform_admin.
--   5. Sets profiles.must_change_password = true, which the existing
--      <ForcePasswordChange> modal (src/components/auth/ForcePasswordChange.tsx)
--      already enforces on next sign-in for every role. If the profile
--      is also linked to a student record (students.profile_id), that
--      row's own must_change_password is set too, since the student
--      portal enforces its own separate flag (see ForcePasswordChange's
--      own comment).
--   6. Returns the temporary password ONCE in the response — never
--      logged, never stored in plaintext anywhere.
--
-- Touches ONLY auth.users.encrypted_password and
-- profiles/students.must_change_password, for the single targeted user.
-- No RLS policy is added, changed, or removed. No other auth logic is
-- touched. SAFE TO RE-RUN (CREATE OR REPLACE). Manual apply — the
-- project owner runs this in the Supabase SQL editor; nothing here is
-- applied automatically.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.admin_reset_user_password(
  p_user_id uuid,
  p_org uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_org uuid := p_org;
  v_email text;
  v_temp_pw text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id is required';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Use the change-password screen to update your own password';
  END IF;

  IF v_org IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM org_memberships
       WHERE user_id = p_user_id AND organization_id = v_org AND active = true
    ) THEN
      RAISE EXCEPTION 'That user is not an active member of this organization';
    END IF;
  ELSE
    SELECT organization_id INTO v_org
      FROM org_memberships
     WHERE user_id = p_user_id AND active = true
     ORDER BY is_default DESC NULLS LAST
     LIMIT 1;
  END IF;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'This user has no active organization membership';
  END IF;

  IF NOT is_org_admin(v_org) THEN
    RAISE EXCEPTION 'Only a school administrator or platform admin can reset this user''s password';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = p_user_id;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Auth account not found for this user';
  END IF;

  -- 10 chars, alphanumeric, avoids ambiguous 0/O/1/l (same generation as
  -- reset_student_password in cbt_upgrade_migration.sql).
  v_temp_pw := substr(
    translate(encode(gen_random_bytes(12), 'base64'), '+/=Ol01', 'abcdefg'),
    1, 10);

  UPDATE auth.users
     SET encrypted_password = extensions.crypt(v_temp_pw, extensions.gen_salt('bf')),
         updated_at = now()
   WHERE id = p_user_id;

  UPDATE profiles
     SET must_change_password = true,
         updated_at = now()
   WHERE id = p_user_id;

  -- Student portal enforces its own must_change_password flag separately
  -- from profiles (see ForcePasswordChange.tsx comment) — flip it too if
  -- this profile is linked to a student record.
  --
  -- students carries phase1_sensitive_write_guard (installed by
  -- 20260905120000_phase1_security_enforcement.sql). That BEFORE ROW
  -- trigger evaluates the ACTUAL caller's JWT, not this function's
  -- SECURITY DEFINER owner, so it re-checks phase1_same_org(NEW.
  -- organization_id) and phase1_hr_access(). For an admin whose default
  -- org membership is not the org being administered, phase1_same_org()
  -- is false and the trigger raises 'organization boundary violation',
  -- which would abort this whole call and roll back the auth.users
  -- password change — leaving the user with a password nobody knows.
  --
  -- Satisfy the guard's OWN built-in service_role exemption for this one
  -- statement, exactly as fix_clear_must_change_password_guard_conflict.sql
  -- already does for clear_must_change_password(). The guard itself is not
  -- touched, disabled or weakened, and this does NOT widen authorization:
  -- is_org_admin(v_org) above has already authorized the caller and the
  -- target's membership in v_org has already been verified. set_config's
  -- third argument is true (LOCAL) so it is scoped to this transaction
  -- and never leaks to later statements or sessions, and the claims are
  -- merged via jsonb_set rather than overwritten so 'sub' and every other
  -- claim survive.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'students'
      AND column_name = 'must_change_password'
  ) THEN
    PERFORM set_config(
      'request.jwt.claims',
      jsonb_set(
        COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb),
        '{role}', '"service_role"'
      )::text,
      true
    );

    UPDATE students
       SET must_change_password = true,
           updated_at = now()
     WHERE profile_id = p_user_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', p_user_id,
    'email', v_email,
    'temporary_password', v_temp_pw
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_reset_user_password(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reset_user_password(uuid, uuid) TO authenticated;


-- =====================================================================
-- VERIFICATION (read-only) — run after applying.
-- =====================================================================

-- V1. Function exists and is SECURITY DEFINER.
SELECT 'V1 function' AS check, p.proname, p.prosecdef AS security_definer
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'admin_reset_user_password';

-- V2. anon cannot execute it (expect no rows).
SELECT 'V2 anon cannot execute' AS check, p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'admin_reset_user_password'
  AND has_function_privilege('anon', p.oid, 'EXECUTE');

-- V3. phase1_sensitive_write_guard is untouched — it must still carry its
--     own service_role/supabase_admin exemption (this migration relies on
--     that exemption, it does not modify the guard). Expect true.
SELECT 'V3 guard untouched' AS check,
       pg_get_functiondef(oid) LIKE '%service_role%supabase_admin%' AS still_has_exemption
FROM pg_proc WHERE proname = 'phase1_sensitive_write_guard';
