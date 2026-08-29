-- ============================================================
-- FIX: parent password reset was calling gen_salt in the public
--      schema, which doesn't have pgcrypto exposed. Route via
--      extensions.crypt / extensions.gen_salt like create_auth_user.
--
-- Also: guarantee that when the auto_provision_staff trigger fires,
-- the org_memberships.role column ALWAYS reflects the staff_type
-- currently on the staff_members row — a change to staff_type
-- cascades cleanly. Fixes the "type shows in Staff but not in Teams"
-- symptom.
--
-- Idempotent, safe to re-run.
-- ============================================================

-- 1. Password reset — use extensions.crypt.
CREATE OR REPLACE FUNCTION public.admin_reset_parent_password(p_parent_profile_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions AS $$
DECLARE
  v_uid uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.org_memberships
     WHERE user_id = auth.uid()
       AND role IN ('super_admin','owner','admin')
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT profile_id INTO v_uid FROM public.parent_profiles WHERE id = p_parent_profile_id;
  IF v_uid IS NULL THEN RETURN 'not_found'; END IF;

  UPDATE auth.users
     SET encrypted_password = extensions.crypt('ChangeMe123!', extensions.gen_salt('bf'))
   WHERE id = v_uid;

  UPDATE public.profiles SET must_change_password = TRUE WHERE id = v_uid;
  RETURN 'ok';
END $$;

GRANT EXECUTE ON FUNCTION public.admin_reset_parent_password(uuid) TO authenticated;

-- 2. Refined auto_provision_staff — now runs on staff_type change too,
--    and ALWAYS pushes staff_type -> role into org_memberships.
CREATE OR REPLACE FUNCTION public.auto_provision_staff()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid   UUID;
  v_email TEXT := LOWER(TRIM(COALESCE(NEW.email, '')));
  v_stype TEXT := LOWER(COALESCE(NEW.staff_type, 'teaching'));
  v_role  TEXT;
BEGIN
  IF v_email = '' THEN
    RETURN NEW;
  END IF;

  v_role := CASE
              WHEN v_stype IN ('admin','administrator') THEN 'admin'
              WHEN v_stype IN ('non_teaching','nonteaching','non teaching','support') THEN 'staff'
              ELSE 'teacher'
            END;

  v_uid := public.create_auth_user(v_email, 'ChangeMe123!', v_role);
  NEW.user_id := v_uid;

  INSERT INTO public.profiles (id, email, full_name, role, organization_id, must_change_password)
  VALUES (v_uid, v_email, COALESCE(NEW.full_name, v_email), v_role, NEW.organization_id, TRUE)
  ON CONFLICT (id) DO UPDATE
    SET role                 = EXCLUDED.role,   -- always push the new role
        organization_id      = COALESCE(public.profiles.organization_id, EXCLUDED.organization_id),
        full_name            = COALESCE(public.profiles.full_name, EXCLUDED.full_name),
        must_change_password = COALESCE(public.profiles.must_change_password, TRUE);

  BEGIN EXECUTE 'UPDATE public.profiles SET active = TRUE WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN EXECUTE 'UPDATE public.profiles SET approved = TRUE WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN EXECUTE 'UPDATE public.profiles SET is_approved = TRUE WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN EXECUTE 'UPDATE public.profiles SET status = ''active'' WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN EXECUTE 'UPDATE public.profiles SET account_status = ''approved'' WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;

  -- Push role into org_memberships. Owner/super_admin are never demoted.
  INSERT INTO public.org_memberships (user_id, organization_id, role, is_default, active)
  VALUES (v_uid, NEW.organization_id, v_role, TRUE, TRUE)
  ON CONFLICT (user_id, organization_id) DO UPDATE
    SET active = TRUE,
        role   = CASE
                   WHEN public.org_memberships.role IN ('super_admin','owner') THEN public.org_memberships.role
                   ELSE EXCLUDED.role
                 END;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_auto_provision_staff ON public.staff_members;
CREATE TRIGGER trg_auto_provision_staff
  BEFORE INSERT OR UPDATE OF email, full_name, staff_type ON public.staff_members
  FOR EACH ROW EXECUTE FUNCTION public.auto_provision_staff();

-- 3. One-off backfill: for every staff_members row that has an email,
--    reapply staff_type -> role in profiles + org_memberships. This
--    cleans up existing users whose Staff Type shows on the Staff page
--    but who show as 'admin' or wrong role on the Team page.
DO $$
DECLARE
  r RECORD;
  v_role text;
BEGIN
  FOR r IN
    SELECT id, user_id, email, staff_type, organization_id
    FROM public.staff_members
    WHERE user_id IS NOT NULL
      AND email IS NOT NULL
      AND TRIM(email) <> ''
  LOOP
    v_role := CASE
                WHEN LOWER(COALESCE(r.staff_type,'teaching')) IN ('admin','administrator') THEN 'admin'
                WHEN LOWER(COALESCE(r.staff_type,'teaching')) IN ('non_teaching','nonteaching','non teaching','support') THEN 'staff'
                ELSE 'teacher'
              END;

    UPDATE public.profiles
       SET role = v_role
     WHERE id = r.user_id
       AND role NOT IN ('super_admin','owner');

    UPDATE public.org_memberships
       SET role = v_role
     WHERE user_id = r.user_id
       AND organization_id = r.organization_id
       AND role NOT IN ('super_admin','owner');
  END LOOP;
END $$;

-- VERIFY
SELECT sm.staff_code, sm.staff_type, sm.email, p.role AS profile_role, om.role AS membership_role
  FROM public.staff_members sm
  LEFT JOIN public.profiles p        ON p.id = sm.user_id
  LEFT JOIN public.org_memberships om ON om.user_id = sm.user_id AND om.organization_id = sm.organization_id
 WHERE sm.email IS NOT NULL AND TRIM(sm.email) <> ''
 ORDER BY sm.staff_code;
