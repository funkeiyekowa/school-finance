-- =====================================================================
-- PLATFORM SUPER ADMIN MANAGEMENT
-- =====================================================================
-- Adds a management surface (Platform Admin -> Super Admins tab) for
-- listing, creating, editing, password-resetting and revoking platform
-- super administrators. Every function is gated on is_platform_admin(),
-- so ONLY an existing super admin can call any of them, and they are
-- REVOKEd from anon/public.
--
-- Model (unchanged, see saas_foundation.sql is_platform_admin()):
--   A user is a platform super admin when EITHER
--     profiles.role = 'developer'  AND profiles.active = true   OR
--     org_memberships.role = 'super_admin' AND active = true
--   We standardise NEW/managed platform admins on profiles.role =
--   'developer' + active (portable: lights up the client isSuperAdmin
--   flag regardless of which org is active), AND keep any existing
--   super_admin memberships working.
--
-- Business IDs, RLS and tenant boundaries are untouched. Idempotent.
-- Manual apply. Includes verification SELECTs at the end.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. list_platform_admins() — every current platform super admin.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_platform_admins()
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text,
  profile_role text,
  active boolean,
  via_developer boolean,
  via_membership boolean,
  is_self boolean,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required';
  END IF;

  RETURN QUERY
  WITH admin_ids AS (
    SELECT p.id AS uid FROM public.profiles p
      WHERE p.role = 'developer' AND COALESCE(p.active, false) = true
    UNION
    SELECT m.user_id AS uid FROM public.org_memberships m
      WHERE m.role = 'super_admin' AND m.active = true
  )
  SELECT
    u.id,
    u.email::text,
    COALESCE(p.full_name, u.email::text),
    p.role,
    COALESCE(p.active, false),
    (p.role = 'developer' AND COALESCE(p.active, false) = true) AS via_developer,
    EXISTS (SELECT 1 FROM public.org_memberships m
              WHERE m.user_id = u.id AND m.role = 'super_admin' AND m.active = true) AS via_membership,
    (u.id = auth.uid()) AS is_self,
    u.created_at,
    u.last_sign_in_at
  FROM admin_ids a
  JOIN auth.users u ON u.id = a.uid
  LEFT JOIN public.profiles p ON p.id = u.id
  ORDER BY COALESCE(p.full_name, u.email::text);
END $$;

REVOKE ALL ON FUNCTION public.list_platform_admins() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_platform_admins() TO authenticated;


-- ---------------------------------------------------------------------
-- 2. create_platform_admin(email, full_name, password?) — mint a new
--    platform super admin. Creates the auth user if needed (reusing
--    create_auth_user), promotes profiles.role = 'developer' + active,
--    and forces a password change on first login.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_platform_admin(
  p_email text,
  p_full_name text DEFAULT NULL,
  p_password text DEFAULT 'ChangeMe123!'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions
AS $$
DECLARE
  v_email text := lower(trim(p_email));
  v_name  text := nullif(trim(p_full_name), '');
  v_pw    text := COALESCE(nullif(trim(p_password), ''), 'ChangeMe123!');
  v_user  uuid;
  v_existed boolean := false;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required';
  END IF;
  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'Email is required';
  END IF;

  SELECT id INTO v_user FROM auth.users WHERE lower(email) = v_email LIMIT 1;

  IF v_user IS NULL THEN
    -- Brand-new account.
    v_user := public.create_auth_user(v_email, v_pw, 'developer');
  ELSE
    v_existed := true;
  END IF;

  -- Promote to platform admin via the portable 'developer' profile role.
  INSERT INTO public.profiles (id, email, full_name, role, active, must_change_password)
  VALUES (v_user, v_email, COALESCE(v_name, v_email), 'developer', true, NOT v_existed)
  ON CONFLICT (id) DO UPDATE
    SET role = 'developer',
        active = true,
        full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name);

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', v_user,
    'email', v_email,
    'existed', v_existed,
    -- Only surface a password for a freshly-created account.
    'password', CASE WHEN v_existed THEN NULL ELSE v_pw END
  );
END $$;

REVOKE ALL ON FUNCTION public.create_platform_admin(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_platform_admin(text, text, text) TO authenticated;


-- ---------------------------------------------------------------------
-- 3. update_platform_admin(user_id, full_name?, password?, active?) —
--    edit a platform admin's name, reset password, or (de)activate.
--    Fail closed: cannot deactivate the LAST active platform admin, and
--    cannot deactivate yourself.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_platform_admin(
  p_user_id uuid,
  p_full_name text DEFAULT NULL,
  p_password text DEFAULT NULL,
  p_active boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions
AS $$
DECLARE
  v_name text := nullif(trim(p_full_name), '');
  v_pw   text := nullif(trim(p_password), '');
  v_active_admins int;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id is required';
  END IF;

  -- Deactivation guards (fail closed).
  IF p_active IS FALSE THEN
    IF p_user_id = auth.uid() THEN
      RAISE EXCEPTION 'You cannot deactivate your own platform admin account';
    END IF;
    SELECT count(*) INTO v_active_admins FROM (
      SELECT id AS uid FROM public.profiles WHERE role = 'developer' AND COALESCE(active,false) = true
      UNION
      SELECT user_id AS uid FROM public.org_memberships WHERE role = 'super_admin' AND active = true
    ) x;
    IF v_active_admins <= 1 THEN
      RAISE EXCEPTION 'Cannot deactivate the last remaining platform admin';
    END IF;
  END IF;

  -- Name / active on profiles.
  IF v_name IS NOT NULL OR p_active IS NOT NULL THEN
    UPDATE public.profiles
       SET full_name = COALESCE(v_name, full_name),
           active    = COALESCE(p_active, active)
     WHERE id = p_user_id;
  END IF;

  -- If deactivating, also stand down any super_admin memberships so the
  -- server-side check flips consistently.
  IF p_active IS FALSE THEN
    UPDATE public.org_memberships SET active = false
      WHERE user_id = p_user_id AND role = 'super_admin';
  END IF;

  -- Password reset (supported hashing path used by create_auth_user).
  IF v_pw IS NOT NULL THEN
    UPDATE auth.users
       SET encrypted_password = extensions.crypt(v_pw, extensions.gen_salt('bf')),
           updated_at = now()
     WHERE id = p_user_id;
    -- Force a change on next login.
    UPDATE public.profiles SET must_change_password = true WHERE id = p_user_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'user_id', p_user_id,
    'password_reset', v_pw IS NOT NULL);
END $$;

REVOKE ALL ON FUNCTION public.update_platform_admin(uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_platform_admin(uuid, text, text, boolean) TO authenticated;


-- ---------------------------------------------------------------------
-- 4. revoke_platform_admin(user_id) — remove platform-admin status
--    WITHOUT deleting the account (they keep any org memberships).
--    Fail closed: cannot revoke yourself or the last platform admin.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_platform_admin(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_active_admins int;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id is required';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot revoke your own platform admin status';
  END IF;

  SELECT count(*) INTO v_active_admins FROM (
    SELECT id AS uid FROM public.profiles WHERE role = 'developer' AND COALESCE(active,false) = true
    UNION
    SELECT user_id AS uid FROM public.org_memberships WHERE role = 'super_admin' AND active = true
  ) x;
  IF v_active_admins <= 1 THEN
    RAISE EXCEPTION 'Cannot revoke the last remaining platform admin';
  END IF;

  -- Drop developer role (demote to a plain member) and stand down any
  -- super_admin memberships. The account and its org memberships remain.
  UPDATE public.profiles
     SET role = 'viewer'
   WHERE id = p_user_id AND role = 'developer';

  UPDATE public.org_memberships SET active = false
   WHERE user_id = p_user_id AND role = 'super_admin';

  RETURN jsonb_build_object('ok', true, 'user_id', p_user_id);
END $$;

REVOKE ALL ON FUNCTION public.revoke_platform_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_platform_admin(uuid) TO authenticated;


-- =====================================================================
-- VERIFICATION (read-only) — run after applying.
-- =====================================================================

-- V1. All four functions exist and are SECURITY DEFINER.
SELECT 'V1 functions' AS check, p.proname, p.prosecdef AS security_definer
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('list_platform_admins','create_platform_admin','update_platform_admin','revoke_platform_admin')
ORDER BY p.proname;

-- V2. None of them are executable by anon (expect no rows).
SELECT 'V2 anon cannot execute' AS check, p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('list_platform_admins','create_platform_admin','update_platform_admin','revoke_platform_admin')
  AND has_function_privilege('anon', p.oid, 'EXECUTE');

-- V3. Current platform admins (sanity: at least 1).
SELECT 'V3 current platform admins' AS check, count(*) AS n FROM (
  SELECT id AS uid FROM public.profiles WHERE role = 'developer' AND COALESCE(active,false) = true
  UNION
  SELECT user_id AS uid FROM public.org_memberships WHERE role = 'super_admin' AND active = true
) x;
