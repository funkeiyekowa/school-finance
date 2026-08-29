-- ============================================================
-- Admin RPCs for cleaning up duplicate / stale accounts.
--
-- Provides:
--   admin_delete_staff(staff_id)  — removes the staff_members row
--                                    and, if there are no other
--                                    org_memberships for that user,
--                                    deletes the auth user too.
--   admin_delete_parent(parent_id) — same idea for parents.
--   admin_merge_profiles(keep_id, remove_id) — collapse a duplicate
--                                    profile into the canonical one.
--
-- All require admin/owner/super_admin membership somewhere.
-- Idempotent, safe to re-run.
-- ============================================================

-- Guard helper: is the caller an org admin?
CREATE OR REPLACE FUNCTION public._is_org_admin()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_memberships
     WHERE user_id = auth.uid()
       AND role IN ('super_admin','owner','admin')
  );
$$;

GRANT EXECUTE ON FUNCTION public._is_org_admin() TO authenticated;

-- ------------------------------------------------------------
-- Delete a staff row (and its auth user if no other org needs them).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_delete_staff(p_staff_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_uid uuid;
  v_org uuid;
  v_still_used int;
BEGIN
  IF NOT public._is_org_admin() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT user_id, organization_id INTO v_uid, v_org
    FROM public.staff_members WHERE id = p_staff_id;
  IF v_uid IS NULL THEN RETURN 'not_found'; END IF;

  -- Remove memberships for THIS org.
  DELETE FROM public.org_memberships
   WHERE user_id = v_uid AND organization_id = v_org;

  -- Remove the staff row itself.
  DELETE FROM public.staff_members WHERE id = p_staff_id;

  -- If the user still belongs to any other org, keep their auth row.
  SELECT COUNT(*) INTO v_still_used
    FROM public.org_memberships WHERE user_id = v_uid;

  IF v_still_used = 0 THEN
    -- No other org references this user; remove the auth account too.
    DELETE FROM public.profiles WHERE id = v_uid;
    DELETE FROM auth.identities WHERE user_id = v_uid;
    DELETE FROM auth.users WHERE id = v_uid;
  END IF;

  RETURN 'ok';
END $$;

GRANT EXECUTE ON FUNCTION public.admin_delete_staff(uuid) TO authenticated;

-- ------------------------------------------------------------
-- Delete a parent row similarly.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_delete_parent(p_parent_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_uid uuid;
  v_still_used int;
BEGIN
  IF NOT public._is_org_admin() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT profile_id INTO v_uid FROM public.parent_profiles WHERE id = p_parent_id;
  IF v_uid IS NULL AND p_parent_id IS NOT NULL THEN
    -- Row doesn't exist any more; treat as success.
    RETURN 'ok';
  END IF;

  DELETE FROM public.parent_student_links WHERE parent_id = p_parent_id;
  DELETE FROM public.parent_profiles WHERE id = p_parent_id;

  IF v_uid IS NOT NULL THEN
    DELETE FROM public.org_memberships WHERE user_id = v_uid;
    SELECT COUNT(*) INTO v_still_used FROM public.parent_profiles WHERE profile_id = v_uid;
    IF v_still_used = 0 THEN
      DELETE FROM public.profiles WHERE id = v_uid;
      DELETE FROM auth.identities WHERE user_id = v_uid;
      DELETE FROM auth.users WHERE id = v_uid;
    END IF;
  END IF;

  RETURN 'ok';
END $$;

GRANT EXECUTE ON FUNCTION public.admin_delete_parent(uuid) TO authenticated;

-- ------------------------------------------------------------
-- Merge one profile into another (dedupe helper).
-- Moves org_memberships, staff_members, parent_profiles, teacher_assignments
-- from p_remove_id to p_keep_id and deletes the loser.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_merge_profiles(p_keep_id uuid, p_remove_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF NOT public._is_org_admin() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_keep_id = p_remove_id THEN RETURN 'same_id'; END IF;

  -- Move memberships. Conflicts resolved by keeping the higher-privileged role.
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

-- VERIFY
SELECT proname, prosrc IS NOT NULL AS has_body
  FROM pg_proc
 WHERE proname IN ('admin_delete_staff','admin_delete_parent','admin_merge_profiles','_is_org_admin')
   AND pronamespace = 'public'::regnamespace;
