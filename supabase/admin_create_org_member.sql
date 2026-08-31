-- =====================================================================
-- ADMIN CREATE ORG MEMBER — create a brand-new person + account,
-- not just link an existing one
-- =====================================================================
-- Run order: after saas_foundation.sql (#22, defines is_org_admin(),
-- is_platform_admin(), add_org_member(), and the org_memberships /
-- profiles tables this builds on), auto_provision_users.sql (#32,
-- defines create_auth_user() which this reuses), and
-- fix_teacher_login_and_password_change.sql (#47, adds
-- profiles.must_change_password, which this sets).
--
-- WHY: add_org_member() (saas_foundation.sql) can only ASSIGN an
-- EXISTING auth.users account to a school — if the email has never
-- signed in before, it returns {"ok": false, "error": "no_such_user"}
-- and the UI tells the admin to "ask them to sign up first". This app
-- has no public signup page for org members (schools are provisioned
-- by a platform admin; students/parents/teachers/staff are the only
-- other flows that auto-create accounts, via create_auth_user()) — so
-- a super admin genuinely could not add a brand-new person to a
-- school at all, contradicting "Superadmin should be able to add any
-- person."
--
-- This mirrors the existing admin_create_parent_user() pattern
-- (fix_staff_login_and_roles.sql): create_auth_user() is never
-- exposed to authenticated/anon directly ("Client-side create_auth_user
-- is unsafe to expose"), so this is a thin admin-gated wrapper that:
--   1. Re-checks is_org_admin(p_org) (same authorization
--      add_org_member() itself requires) and, same as add_org_member(),
--      only a platform admin may mint another super_admin.
--   2. Refuses if an account with that email already exists — that
--      case should go through the existing add_org_member() instead,
--      so there is exactly one way to reach each outcome.
--   3. Creates the auth.users/auth.identities row via create_auth_user()
--      with the same default password every other auto-provisioned
--      account gets ("ChangeMe123!") — the app already forces a
--      password change on first login for that shared default via
--      must_change_password elsewhere, so this sets it too.
--   4. Seeds a profiles row (full_name, role) — the on_auth_user_created
--      trigger already inserts a bare profiles row from schema.sql, so
--      this UPDATEs it with the name/role we actually know, the same
--      "insert via trigger, then correct via ON CONFLICT" shape
--      admin_create_parent_user() uses.
--   5. Creates the org_membership exactly as add_org_member() does
--      (default-org bookkeeping included), so the two RPCs produce
--      identical membership rows regardless of which one was used.
--
-- SAFE TO RE-RUN: CREATE OR REPLACE. Calling it twice for the same
-- email fails on step 2 the second time (account already exists) —
-- that's intentional, not a bug: re-run add_org_member() instead.
-- =====================================================================

CREATE OR REPLACE FUNCTION admin_create_org_member(
  p_org uuid,
  p_email text,
  p_full_name text,
  p_role text DEFAULT 'staff',
  p_make_default boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_email text := lower(trim(p_email));
  v_name text := nullif(trim(p_full_name), '');
  v_user uuid;
  v_password text := 'ChangeMe123!';
BEGIN
  IF NOT is_org_admin(p_org) THEN
    RAISE EXCEPTION 'Not authorized to manage members of this organization';
  END IF;

  IF v_email = '' OR v_email IS NULL THEN
    RAISE EXCEPTION 'Email is required';
  END IF;

  IF p_role NOT IN ('super_admin','owner','admin','staff','editor','viewer','teacher','parent','student','accountant','bursar') THEN
    RAISE EXCEPTION 'Invalid role: %', p_role;
  END IF;

  -- Only platform admins may mint another super_admin.
  IF p_role = 'super_admin' AND NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Only platform admins can assign super_admin';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = v_email) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'user_exists',
      'message', format('An account for %s already exists. Use "Assign existing account" instead.', v_email)
    );
  END IF;

  v_user := public.create_auth_user(v_email, v_password, p_role);

  -- create_auth_user() only inserts auth.users/auth.identities. A
  -- profiles row for v_user already exists via the on_auth_user_created
  -- trigger (schema.sql) with role defaulted from signup order —
  -- correct it to the role/name actually chosen here.
  UPDATE profiles
  SET full_name = COALESCE(v_name, full_name),
      role = p_role,
      active = true,
      must_change_password = true
  WHERE id = v_user;

  INSERT INTO org_memberships (user_id, organization_id, role, is_default, active, invited_by, invited_at)
  VALUES (v_user, p_org, p_role, false, true, auth.uid(), now())
  ON CONFLICT (user_id, organization_id)
    DO UPDATE SET role = EXCLUDED.role, active = true;

  IF p_make_default THEN
    UPDATE org_memberships SET is_default = false
      WHERE user_id = v_user AND organization_id <> p_org;
    UPDATE org_memberships SET is_default = true
      WHERE user_id = v_user AND organization_id = p_org;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM org_memberships WHERE user_id = v_user AND is_default = true) THEN
      UPDATE org_memberships SET is_default = true
        WHERE user_id = v_user AND organization_id = p_org;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', v_user,
    'email', v_email,
    'role', p_role,
    'password', v_password
  );
END $$;

REVOKE ALL ON FUNCTION admin_create_org_member(uuid, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_create_org_member(uuid, text, text, text, boolean) TO authenticated;
