-- =====================================================================
-- PROVISION STAFF LOGIN (on demand)
-- =====================================================================
-- A staff member can only be allocated as a class teacher / subject
-- teacher once they have a linked login account (staff_members.user_id).
-- Today that login is created by the auto_provision_staff trigger, but
-- ONLY when the staff row has an email -- so a teacher added without an
-- email (e.g. "Olu Ola") has user_id = NULL and cannot be allocated.
--
-- This RPC lets an admin give such a staff member a login on demand by
-- supplying an email, reusing the SAME mechanism the trigger uses
-- (create_auth_user + profiles + org_memberships), then linking it onto
-- the staff row. It is idempotent and org-scoped.
--
-- Authorization: SECURITY DEFINER, gated by is_org_admin(current org).
-- Does NOT change auto_provision_staff or any existing behaviour.
--
-- SAFE TO RE-RUN.
-- =====================================================================

CREATE OR REPLACE FUNCTION provision_staff_login(p_staff_id uuid, p_email text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions
AS $$
DECLARE
  v_org    uuid := current_user_org_id();
  v_email  text := lower(trim(coalesce(p_email, '')));
  v_stype  text;
  v_name   text;
  v_role   text;
  v_uid    uuid;
  v_existing_uid uuid;
BEGIN
  IF v_org IS NULL OR NOT is_org_admin(v_org) THEN
    RAISE EXCEPTION 'Not authorized.';
  END IF;

  IF p_staff_id IS NULL THEN
    RAISE EXCEPTION 'A staff member is required.';
  END IF;
  IF v_email = '' THEN
    RAISE EXCEPTION 'An email address is required to create a login.';
  END IF;
  IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'Enter a valid email address.';
  END IF;

  -- The staff row must belong to this org.
  SELECT staff_type, full_name, user_id
    INTO v_stype, v_name, v_existing_uid
  FROM staff_members
  WHERE id = p_staff_id AND organization_id = v_org;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That staff member does not belong to your school.';
  END IF;

  -- If already linked, just make sure the email is recorded and return.
  IF v_existing_uid IS NOT NULL THEN
    UPDATE staff_members
      SET email = COALESCE(NULLIF(email, ''), v_email)
    WHERE id = p_staff_id AND organization_id = v_org;
    RETURN jsonb_build_object('ok', true, 'user_id', v_existing_uid, 'already_linked', true, 'email', v_email);
  END IF;

  -- Guard: don't hijack another staff member's email in this org.
  IF EXISTS (
    SELECT 1 FROM staff_members
    WHERE organization_id = v_org AND lower(email) = v_email AND id <> p_staff_id
  ) THEN
    RAISE EXCEPTION 'Another staff member already uses %.', v_email;
  END IF;

  v_stype := lower(coalesce(v_stype, 'teaching'));
  v_role := CASE
              WHEN v_stype IN ('admin','administrator') THEN 'admin'
              WHEN v_stype IN ('non_teaching','nonteaching','non teaching','support') THEN 'staff'
              ELSE 'teacher'
            END;

  -- Reuse the exact provisioning mechanism used by auto_provision_staff.
  -- create_auth_user is idempotent by email (returns an existing uid).
  v_uid := public.create_auth_user(v_email, 'ChangeMe123!', v_role);

  UPDATE staff_members
    SET user_id = v_uid, email = v_email
  WHERE id = p_staff_id AND organization_id = v_org;

  INSERT INTO public.profiles (id, email, full_name, role, organization_id, must_change_password)
  VALUES (v_uid, v_email, COALESCE(v_name, v_email), v_role, v_org, TRUE)
  ON CONFLICT (id) DO UPDATE
    SET role            = EXCLUDED.role,
        organization_id = COALESCE(public.profiles.organization_id, EXCLUDED.organization_id),
        full_name       = COALESCE(public.profiles.full_name, EXCLUDED.full_name);

  BEGIN EXECUTE 'UPDATE public.profiles SET active = TRUE WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;

  INSERT INTO public.org_memberships (user_id, organization_id, role, is_default, active)
  VALUES (v_uid, v_org, v_role, TRUE, TRUE)
  ON CONFLICT (user_id, organization_id) DO UPDATE
    SET active = TRUE,
        role   = CASE
                   WHEN public.org_memberships.role IN ('super_admin','owner') THEN public.org_memberships.role
                   ELSE EXCLUDED.role
                 END;

  RETURN jsonb_build_object('ok', true, 'user_id', v_uid, 'already_linked', false, 'email', v_email);
END;
$$;

GRANT EXECUTE ON FUNCTION provision_staff_login(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------
SELECT (SELECT COUNT(*) FROM pg_proc WHERE proname = 'provision_staff_login') AS provision_staff_login_installed;
