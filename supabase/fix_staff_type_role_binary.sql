-- ============================================================
-- FIX: staff_type -> role must be binary.
--
-- Rule from the product owner:
--   staff_type = 'admin'  -> role = 'admin'
--   ANYTHING ELSE         -> role = 'teacher'
--
-- (Non-teaching, Support, future staff_types like 'librarian',
-- 'nurse', 'security', 'driver' etc. all resolve to teacher role
-- so they land in the teacher portal.)
--
-- Idempotent, safe to re-run.
-- ============================================================

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

  -- ONLY admin -> admin. Every other staff_type is a teacher.
  v_role := CASE WHEN v_stype IN ('admin','administrator') THEN 'admin' ELSE 'teacher' END;

  v_uid := public.create_auth_user(v_email, 'ChangeMe123!', v_role);
  NEW.user_id := v_uid;

  INSERT INTO public.profiles (id, email, full_name, role, organization_id, must_change_password)
  VALUES (v_uid, v_email, COALESCE(NEW.full_name, v_email), v_role, NEW.organization_id, TRUE)
  ON CONFLICT (id) DO UPDATE
    SET role                 = EXCLUDED.role,
        organization_id      = COALESCE(public.profiles.organization_id, EXCLUDED.organization_id),
        full_name            = COALESCE(public.profiles.full_name, EXCLUDED.full_name),
        must_change_password = COALESCE(public.profiles.must_change_password, TRUE);

  BEGIN EXECUTE 'UPDATE public.profiles SET active = TRUE WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN EXECUTE 'UPDATE public.profiles SET approved = TRUE WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN EXECUTE 'UPDATE public.profiles SET is_approved = TRUE WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN EXECUTE 'UPDATE public.profiles SET status = ''active'' WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN EXECUTE 'UPDATE public.profiles SET account_status = ''approved'' WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;

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

-- Same binary rule inside resolve_login_context so a Non-teaching
-- login lands on the teacher redirect, not admin.
CREATE OR REPLACE FUNCTION public.resolve_login_context(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_org_name text;
  v_role text := NULL;
  v_redirect text := NULL;
  v_student_id uuid := NULL;
  v_membership_role text;
  v_staff_type text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('role', NULL, 'reason', 'not_signed_in');
  END IF;

  SELECT id, name INTO v_org_id, v_org_name
    FROM public.organizations
   WHERE slug = LOWER(TRIM(p_slug));

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('role', NULL, 'reason', 'org_not_found');
  END IF;

  SELECT LOWER(COALESCE(staff_type,'teaching')) INTO v_staff_type
    FROM public.staff_members
   WHERE user_id = v_uid AND organization_id = v_org_id
   LIMIT 1;

  IF v_staff_type IS NOT NULL THEN
    IF v_staff_type IN ('admin','administrator') THEN
      v_role := 'admin'; v_redirect := '/dashboard';
    ELSE
      -- Every non-admin staff_type resolves to teacher.
      v_role := 'teacher'; v_redirect := '/dashboard/teaching';
    END IF;
  END IF;

  IF v_role IS NULL THEN
    SELECT role INTO v_membership_role
      FROM public.org_memberships
     WHERE user_id = v_uid AND organization_id = v_org_id AND active = TRUE
     LIMIT 1;

    IF v_membership_role IN ('super_admin','owner','admin','developer','editor') THEN
      v_role := 'admin'; v_redirect := '/dashboard';
    ELSIF v_membership_role IN ('teacher','staff','bursar','accountant') THEN
      -- Legacy 'staff' membership also routes to teacher portal per new rule.
      v_role := 'teacher'; v_redirect := '/dashboard/teaching';
    ELSIF v_membership_role = 'parent' THEN
      v_role := 'parent'; v_redirect := '/dashboard/parent-portal';
    ELSIF v_membership_role = 'student' THEN
      v_role := 'student'; v_redirect := '/dashboard/student-portal';
    END IF;
  END IF;

  IF v_role IS NULL THEN
    SELECT id INTO v_student_id
      FROM public.students
     WHERE profile_id = v_uid AND organization_id = v_org_id
     LIMIT 1;
    IF v_student_id IS NOT NULL THEN
      v_role := 'student'; v_redirect := '/dashboard/student-portal';
    END IF;
  END IF;

  IF v_role IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.parent_profiles pp
        JOIN public.parent_student_links psl ON psl.parent_id = pp.id
        JOIN public.students s ON s.id = psl.student_id
       WHERE pp.profile_id = v_uid AND s.organization_id = v_org_id
    ) THEN
      v_role := 'parent'; v_redirect := '/dashboard/parent-portal';
    END IF;
  END IF;

  IF v_role IS NOT NULL THEN
    PERFORM public._flip_profile_approval(v_uid);

    UPDATE public.profiles
       SET role = COALESCE(NULLIF(role, 'pending'), v_role),
           organization_id = COALESCE(organization_id, v_org_id)
     WHERE id = v_uid;

    INSERT INTO public.org_memberships (user_id, organization_id, role, is_default, active)
    VALUES (v_uid, v_org_id, v_role, TRUE, TRUE)
    ON CONFLICT (user_id, organization_id) DO UPDATE
      SET active = TRUE,
          role   = CASE WHEN public.org_memberships.role IN ('super_admin','owner') THEN public.org_memberships.role ELSE EXCLUDED.role END;
  END IF;

  RETURN jsonb_build_object(
    'role', v_role, 'redirect', v_redirect,
    'organization_id', v_org_id, 'organization_name', v_org_name,
    'student_id', v_student_id,
    'reason', CASE WHEN v_role IS NULL THEN 'not_attached' ELSE 'ok' END
  );
END $$;

GRANT EXECUTE ON FUNCTION public.resolve_login_context(text) TO authenticated;

-- Backfill: any non-admin staff_type user currently marked as 'staff'
-- gets flipped to 'teacher' in both profiles and org_memberships.
DO $$
DECLARE
  r RECORD;
  v_role text;
BEGIN
  FOR r IN
    SELECT id, user_id, staff_type, organization_id
    FROM public.staff_members
    WHERE user_id IS NOT NULL
  LOOP
    v_role := CASE WHEN LOWER(COALESCE(r.staff_type,'teaching')) IN ('admin','administrator') THEN 'admin' ELSE 'teacher' END;

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

SELECT sm.staff_code, sm.staff_type, p.role AS profile_role, om.role AS membership_role
  FROM public.staff_members sm
  LEFT JOIN public.profiles p        ON p.id = sm.user_id
  LEFT JOIN public.org_memberships om ON om.user_id = sm.user_id AND om.organization_id = sm.organization_id
 WHERE sm.email IS NOT NULL AND TRIM(sm.email) <> ''
 ORDER BY sm.staff_code;
