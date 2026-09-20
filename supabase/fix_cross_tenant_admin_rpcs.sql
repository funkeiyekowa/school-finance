-- =====================================================================
-- SECURITY FIX — cross-tenant admin RPCs
-- =====================================================================
-- Run order: after admin_delete_and_merge.sql, fix_pending_role_promotion.sql
-- and saas_foundation.sql (#22, defines the correctly org-scoped
-- is_org_admin(p_org) and is_platform_admin()). Adds and changes NO RLS
-- policy, so it is order-independent with respect to
-- rls_role_scoped_access.sql and may be run last at any time.
-- Idempotent (CREATE OR REPLACE). Manual apply in the Supabase SQL editor.
--
-- ---------------------------------------------------------------------
-- WHY
-- ---------------------------------------------------------------------
-- public._is_org_admin() (admin_delete_and_merge.sql:18) answers "is the
-- caller an admin of ANY organization?" — it has no organization_id
-- predicate:
--
--     SELECT EXISTS (SELECT 1 FROM org_memberships
--        WHERE user_id = auth.uid() AND role IN ('super_admin','owner','admin'));
--
-- It is the ONLY guard on three SECURITY DEFINER functions that delete
-- auth users and move org memberships. Because the target is addressed by
-- a caller-supplied id whose organization is never compared to the
-- caller's, an admin of School A can operate on School B's people:
--
--   * admin_delete_staff(uuid)    — deletes another school's staff_members
--     row, their org_memberships, and (when no other org references them)
--     their profiles + auth.identities + auth.users rows.
--   * admin_delete_parent(uuid)   — same, and its membership DELETE had no
--     org filter at all, stripping the victim's membership in EVERY school.
--   * admin_merge_profiles(a, b)  — privilege escalation, not just
--     destruction: it copies every org_membership from the removed profile
--     onto the kept one, preserving role. An admin of School A could call
--     admin_merge_profiles(<own id>, <School B owner id>) and inherit that
--     owner membership, then the victim's auth user is deleted.
--
-- promote_pending_profile(uuid) (fix_pending_role_promotion.sql:99) has no
-- authorization check whatsoever and is granted to `authenticated`. Any
-- signed-in user could pass an arbitrary profile id and set role + active
-- on it — reactivating a deliberately deactivated account (dashboard/
-- layout.tsx redirects on !profile.active) or repairing a downgraded
-- profiles.role to 'admin'. It is also the one SECURITY DEFINER function
-- in this area declared without SET search_path. It has no call sites in
-- src/, so tightening it cannot regress the app.
--
-- ---------------------------------------------------------------------
-- WHAT THIS CHANGES
-- ---------------------------------------------------------------------
-- Each function now resolves the TARGET's organization first and gates on
-- the existing, correctly scoped is_org_admin(<that org>) — which already
-- returns true for platform admins, so cross-tenant support access is
-- preserved deliberately and explicitly rather than by accident.
-- _is_org_admin() itself is left defined (dropping it would break a re-run
-- of admin_delete_and_merge.sql) but is no longer relied on by anything.
--
-- NOT CHANGED, deliberately:
--   auth_email_exists(text) is granted to `anon` and does allow account
--   enumeration platform-wide. It is called pre-login by
--   src/app/auth/forgot-password/page.tsx, so revoking `anon` would break
--   a working user flow. The correct remedy is rate limiting / always
--   returning a neutral "if an account exists we've sent a link" response,
--   which is a product change and is left for a separate decision.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. admin_delete_staff — gate on the TARGET staff row's organization.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_delete_staff(p_staff_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_uid uuid;
  v_org uuid;
  v_still_used int;
BEGIN
  SELECT user_id, organization_id INTO v_uid, v_org
    FROM public.staff_members WHERE id = p_staff_id;
  IF v_org IS NULL THEN RETURN 'not_found'; END IF;

  -- Authorize against the target's org, not "any org".
  IF NOT public.is_org_admin(v_org) THEN RAISE EXCEPTION 'not_authorized'; END IF;

  IF v_uid IS NULL THEN
    DELETE FROM public.staff_members WHERE id = p_staff_id;
    RETURN 'ok';
  END IF;

  DELETE FROM public.org_memberships
   WHERE user_id = v_uid AND organization_id = v_org;

  DELETE FROM public.staff_members WHERE id = p_staff_id;

  SELECT COUNT(*) INTO v_still_used
    FROM public.org_memberships WHERE user_id = v_uid;

  IF v_still_used = 0 THEN
    DELETE FROM public.profiles WHERE id = v_uid;
    DELETE FROM auth.identities WHERE user_id = v_uid;
    DELETE FROM auth.users WHERE id = v_uid;
  END IF;

  RETURN 'ok';
END $$;

GRANT EXECUTE ON FUNCTION public.admin_delete_staff(uuid) TO authenticated;


-- ---------------------------------------------------------------------
-- 2. admin_delete_parent — gate on the parent row's organization, and
--    scope the membership delete to that org (it was unscoped).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_delete_parent(p_parent_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_uid uuid;
  v_org uuid;
  v_still_used int;
BEGIN
  SELECT profile_id, organization_id INTO v_uid, v_org
    FROM public.parent_profiles WHERE id = p_parent_id;

  -- Row already gone: nothing to authorize and nothing to do.
  IF v_org IS NULL THEN RETURN 'ok'; END IF;

  IF NOT public.is_org_admin(v_org) THEN RAISE EXCEPTION 'not_authorized'; END IF;

  DELETE FROM public.parent_student_links WHERE parent_id = p_parent_id;
  DELETE FROM public.parent_profiles WHERE id = p_parent_id;

  IF v_uid IS NOT NULL THEN
    -- Scoped to THIS org. The original stripped every membership the
    -- victim held, in every school.
    DELETE FROM public.org_memberships
     WHERE user_id = v_uid AND organization_id = v_org;

    -- Only reap the auth account when nothing anywhere still references it.
    SELECT COUNT(*) INTO v_still_used
      FROM public.parent_profiles WHERE profile_id = v_uid;
    IF v_still_used = 0 AND NOT EXISTS (
      SELECT 1 FROM public.org_memberships WHERE user_id = v_uid
    ) THEN
      DELETE FROM public.profiles WHERE id = v_uid;
      DELETE FROM auth.identities WHERE user_id = v_uid;
      DELETE FROM auth.users WHERE id = v_uid;
    END IF;
  END IF;

  RETURN 'ok';
END $$;

GRANT EXECUTE ON FUNCTION public.admin_delete_parent(uuid) TO authenticated;


-- ---------------------------------------------------------------------
-- 3. admin_merge_profiles — the caller must administer EVERY org either
--    profile belongs to. Otherwise merging is a privilege-transfer
--    primitive across tenants.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_merge_profiles(p_keep_id uuid, p_remove_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_org uuid;
BEGIN
  IF p_keep_id IS NULL OR p_remove_id IS NULL THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_keep_id = p_remove_id THEN RETURN 'same_id'; END IF;

  -- Every org touched by either side must be one the caller administers.
  -- is_org_admin() already returns true for platform admins.
  FOR v_org IN
    SELECT DISTINCT organization_id
      FROM public.org_memberships
     WHERE user_id IN (p_keep_id, p_remove_id)
       AND organization_id IS NOT NULL
  LOOP
    IF NOT public.is_org_admin(v_org) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  END LOOP;

  -- Neither profile has any membership: nothing establishes a tenant this
  -- merge belongs to, so refuse rather than guess.
  IF NOT EXISTS (
    SELECT 1 FROM public.org_memberships WHERE user_id IN (p_keep_id, p_remove_id)
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  INSERT INTO public.org_memberships (user_id, organization_id, role, is_default, active)
  SELECT p_keep_id, organization_id, role, is_default, active
    FROM public.org_memberships WHERE user_id = p_remove_id
  ON CONFLICT (user_id, organization_id) DO UPDATE
    SET role = CASE WHEN public.org_memberships.role IN ('super_admin','owner') THEN public.org_memberships.role ELSE EXCLUDED.role END,
        active = TRUE;
  DELETE FROM public.org_memberships WHERE user_id = p_remove_id;

  UPDATE public.staff_members SET user_id = p_keep_id WHERE user_id = p_remove_id;
  UPDATE public.parent_profiles SET profile_id = p_keep_id WHERE profile_id = p_remove_id;

  BEGIN
    UPDATE public.teacher_assignments SET user_id = p_keep_id WHERE user_id = p_remove_id;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  BEGIN
    UPDATE public.students SET profile_id = p_keep_id WHERE profile_id = p_remove_id;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;

  DELETE FROM public.profiles WHERE id = p_remove_id;
  DELETE FROM auth.identities WHERE user_id = p_remove_id;
  DELETE FROM auth.users WHERE id = p_remove_id;
  RETURN 'ok';
END $$;

GRANT EXECUTE ON FUNCTION public.admin_merge_profiles(uuid, uuid) TO authenticated;


-- ---------------------------------------------------------------------
-- 4. promote_pending_profile — self-service only, or an admin of an org
--    the target actually belongs to. Adds the missing SET search_path.
--    (No call sites in src/; this cannot regress the app.)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.promote_pending_profile(p_profile uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text;
  v_email text;
  v_allowed boolean := false;
BEGIN
  IF p_profile IS NULL OR auth.uid() IS NULL THEN RETURN NULL; END IF;

  IF p_profile = auth.uid() THEN
    v_allowed := true;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.org_memberships m
       WHERE m.user_id = p_profile
         AND public.is_org_admin(m.organization_id)
    ) INTO v_allowed;
  END IF;

  IF NOT v_allowed THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT email INTO v_email FROM public.profiles WHERE id = p_profile;
  IF v_email IS NULL THEN RETURN NULL; END IF;

  IF EXISTS (SELECT 1 FROM public.students WHERE profile_id = p_profile) THEN
    v_role := 'student';
  ELSIF EXISTS (SELECT 1 FROM public.parent_profiles WHERE profile_id = p_profile) THEN
    v_role := 'parent';
  ELSIF EXISTS (SELECT 1 FROM public.teacher_assignments WHERE user_id = p_profile) THEN
    v_role := 'teacher';
  ELSIF EXISTS (SELECT 1 FROM public.staff_members
                 WHERE LOWER(COALESCE(email,'')) = LOWER(v_email)) THEN
    v_role := 'teacher';
  ELSIF EXISTS (SELECT 1 FROM public.org_memberships
                 WHERE user_id = p_profile AND role IN ('owner','admin')) THEN
    v_role := 'admin';
  END IF;

  IF v_role IS NOT NULL THEN
    UPDATE public.profiles
       SET role = v_role,
           active = true
     WHERE id = p_profile;
  END IF;
  RETURN v_role;
END $$;

GRANT EXECUTE ON FUNCTION public.promote_pending_profile(uuid) TO authenticated;


-- =====================================================================
-- VERIFICATION (read-only) — run after applying.
-- =====================================================================

-- V1. All four functions exist, are SECURITY DEFINER, and now pin search_path.
SELECT 'V1' AS check, p.proname, p.prosecdef AS security_definer,
       p.proconfig AS settings
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('admin_delete_staff','admin_delete_parent',
                    'admin_merge_profiles','promote_pending_profile')
ORDER BY p.proname;

-- V2. None of them still reference the unscoped guard (expect 0 rows).
SELECT 'V2 still uses _is_org_admin()' AS check, p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('admin_delete_staff','admin_delete_parent',
                    'admin_merge_profiles')
  AND pg_get_functiondef(p.oid) LIKE '%_is_org_admin()%';

-- V3. anon holds EXECUTE on none of them (expect 0 rows).
SELECT 'V3 anon executable' AS check, p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('admin_delete_staff','admin_delete_parent',
                    'admin_merge_profiles','promote_pending_profile')
  AND has_function_privilege('anon', p.oid, 'EXECUTE');
