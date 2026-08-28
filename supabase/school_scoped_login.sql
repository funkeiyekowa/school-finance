-- =====================================================================
-- SCHOOL-SCOPED LOGIN (Round 3)
-- =====================================================================
-- Adds:
--   1. resolve_login_context(p_slug)  — SECURITY DEFINER RPC returning
--      the caller's role + redirect + org for a given school slug.
--   2. handle_new_user_school_binding  — AFTER INSERT trigger on
--      auth.users that back-fills parent/teacher provisioning by email.
--   3. Bulk auto-approval for anyone whose role can be verified in an org.
--
-- Idempotent. Safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Helper: flip any approval-shaped columns for one profile row.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._flip_profile_approval(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  BEGIN
    UPDATE public.profiles SET active = TRUE WHERE id = p_user_id;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;
  BEGIN
    UPDATE public.profiles SET approved = TRUE WHERE id = p_user_id;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;
  BEGIN
    UPDATE public.profiles SET is_approved = TRUE WHERE id = p_user_id;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;
  BEGIN
    UPDATE public.profiles SET status = 'active' WHERE id = p_user_id;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;
  BEGIN
    UPDATE public.profiles SET account_status = 'approved' WHERE id = p_user_id;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;
END $fn$;


-- ---------------------------------------------------------------------
-- 1. resolve_login_context(p_slug)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_login_context(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_org_name text;
  v_role text := NULL;
  v_redirect text := NULL;
  v_student_id uuid := NULL;
  v_membership_role text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'role', NULL, 'redirect', NULL,
      'organization_id', NULL, 'organization_name', NULL,
      'student_id', NULL, 'reason', 'not_signed_in'
    );
  END IF;

  SELECT id, name INTO v_org_id, v_org_name
  FROM public.organizations
  WHERE slug = LOWER(TRIM(p_slug));

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object(
      'role', NULL, 'redirect', NULL,
      'organization_id', NULL, 'organization_name', NULL,
      'student_id', NULL, 'reason', 'unknown_school'
    );
  END IF;

  -- 1. Admin / owner / staff (via org_memberships)
  SELECT role INTO v_membership_role
  FROM public.org_memberships
  WHERE user_id = v_uid
    AND organization_id = v_org_id
    AND active = TRUE
  LIMIT 1;

  IF v_membership_role IN ('super_admin','owner','admin','staff','developer','editor') THEN
    v_role := 'admin'; v_redirect := '/dashboard';
  ELSIF v_membership_role = 'teacher' THEN
    v_role := 'teacher'; v_redirect := '/dashboard/teaching';
  ELSIF v_membership_role = 'parent' THEN
    v_role := 'parent'; v_redirect := '/dashboard/parent-portal';
  ELSIF v_membership_role = 'student' THEN
    v_role := 'student'; v_redirect := '/dashboard/student-portal';
  END IF;

  -- 2. Teacher via staff_members / teacher_assignments
  IF v_role IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.staff_members
      WHERE user_id = v_uid AND organization_id = v_org_id
    ) OR EXISTS (
      SELECT 1 FROM public.teacher_assignments
      WHERE user_id = v_uid AND organization_id = v_org_id AND active = TRUE
    ) THEN
      v_role := 'teacher'; v_redirect := '/dashboard/teaching';
    END IF;
  END IF;

  -- 3. Student
  IF v_role IS NULL THEN
    SELECT id INTO v_student_id
    FROM public.students
    WHERE profile_id = v_uid AND organization_id = v_org_id
    LIMIT 1;
    IF v_student_id IS NOT NULL THEN
      v_role := 'student'; v_redirect := '/dashboard/student-portal';
    END IF;
  END IF;

  -- 4. Parent
  IF v_role IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.parent_profiles pp
      JOIN public.parent_student_links psl ON psl.parent_id = pp.id
      JOIN public.students s ON s.id = psl.student_id
      WHERE pp.profile_id = v_uid
        AND s.organization_id = v_org_id
    ) THEN
      v_role := 'parent'; v_redirect := '/dashboard/parent-portal';
    END IF;
  END IF;

  -- Side effects: auto-approve + guarantee membership so
  -- current_user_org_id() lands here.
  IF v_role IS NOT NULL THEN
    PERFORM public._flip_profile_approval(v_uid);

    BEGIN
      UPDATE public.profiles
        SET role = COALESCE(NULLIF(role, 'pending'), v_role),
            organization_id = COALESCE(organization_id, v_org_id)
      WHERE id = v_uid;
    EXCEPTION WHEN undefined_column THEN
      BEGIN
        UPDATE public.profiles
          SET role = COALESCE(NULLIF(role, 'pending'), v_role)
        WHERE id = v_uid;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END;

    INSERT INTO public.org_memberships (user_id, organization_id, role, is_default, active)
    VALUES (
      v_uid, v_org_id,
      CASE WHEN v_role = 'admin' THEN 'admin' ELSE v_role END,
      TRUE, TRUE
    )
    ON CONFLICT (user_id, organization_id) DO UPDATE
      SET active = TRUE;
  END IF;

  RETURN jsonb_build_object(
    'role', v_role,
    'redirect', v_redirect,
    'organization_id', v_org_id,
    'organization_name', v_org_name,
    'student_id', v_student_id,
    'reason', CASE WHEN v_role IS NULL THEN 'not_attached' ELSE 'ok' END
  );
END $fn$;

REVOKE ALL ON FUNCTION public.resolve_login_context(text) FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_login_context(text) TO authenticated;


-- ---------------------------------------------------------------------
-- 2. Safety-net trigger: handle_new_user_school_binding
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user_school_binding()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_email text := LOWER(NEW.email);
  v_org_id uuid;
  v_parent_id uuid;
  v_student_id uuid;
  v_matched boolean := FALSE;
BEGIN
  IF v_email IS NULL OR v_email = '' THEN
    RETURN NEW;
  END IF;

  -- 1. Guardian match -> parent binding
  SELECT id, organization_id INTO v_student_id, v_org_id
  FROM public.students
  WHERE LOWER(guardian_email) = v_email
    AND organization_id IS NOT NULL
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_student_id IS NOT NULL THEN
    INSERT INTO public.parent_profiles (organization_id, profile_id, full_name, email)
    VALUES (v_org_id, NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', v_email), v_email)
    ON CONFLICT DO NOTHING;

    SELECT id INTO v_parent_id FROM public.parent_profiles
     WHERE profile_id = NEW.id AND organization_id = v_org_id
     LIMIT 1;

    IF v_parent_id IS NOT NULL THEN
      INSERT INTO public.parent_student_links (organization_id, parent_id, student_id)
      SELECT s.organization_id, v_parent_id, s.id
        FROM public.students s
       WHERE LOWER(s.guardian_email) = v_email
         AND s.organization_id = v_org_id
      ON CONFLICT (parent_id, student_id) DO NOTHING;
    END IF;

    INSERT INTO public.org_memberships (user_id, organization_id, role, is_default, active)
    VALUES (NEW.id, v_org_id, 'parent', TRUE, TRUE)
    ON CONFLICT (user_id, organization_id) DO UPDATE SET active = TRUE;

    v_matched := TRUE;
  END IF;

  -- 2. Staff email -> teacher binding
  IF NOT v_matched THEN
    SELECT organization_id INTO v_org_id
    FROM public.staff_members
    WHERE LOWER(email) = v_email
      AND organization_id IS NOT NULL
    LIMIT 1;

    IF v_org_id IS NOT NULL THEN
      UPDATE public.staff_members
        SET user_id = NEW.id
      WHERE LOWER(email) = v_email
        AND organization_id = v_org_id
        AND user_id IS NULL;

      INSERT INTO public.org_memberships (user_id, organization_id, role, is_default, active)
      VALUES (NEW.id, v_org_id, 'teacher', TRUE, TRUE)
      ON CONFLICT (user_id, organization_id) DO UPDATE SET active = TRUE;

      v_matched := TRUE;
    END IF;
  END IF;

  IF v_matched THEN
    BEGIN
      PERFORM public._flip_profile_approval(NEW.id);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_new_user_school_binding ON auth.users;
CREATE TRIGGER trg_new_user_school_binding
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_school_binding();


-- ---------------------------------------------------------------------
-- 3. BULK: auto-approve anyone whose role can be verified in an org.
-- ---------------------------------------------------------------------
DO $bulk$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT user_id AS uid FROM public.org_memberships WHERE active = TRUE
    UNION
    SELECT DISTINCT user_id AS uid FROM public.staff_members WHERE user_id IS NOT NULL
    UNION
    SELECT DISTINCT user_id AS uid FROM public.teacher_assignments WHERE active = TRUE
    UNION
    SELECT DISTINCT profile_id AS uid FROM public.students WHERE profile_id IS NOT NULL
    UNION
    SELECT DISTINCT profile_id AS uid FROM public.parent_profiles WHERE profile_id IS NOT NULL
  LOOP
    IF r.uid IS NOT NULL THEN
      PERFORM public._flip_profile_approval(r.uid);
    END IF;
  END LOOP;
END $bulk$;


-- ---------------------------------------------------------------------
-- 4. Verifier
-- ---------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM public.org_memberships WHERE active = TRUE
     AND role IN ('super_admin','owner','admin','staff','developer','editor'))            AS admin_like,
  (SELECT count(*) FROM public.org_memberships WHERE active = TRUE AND role = 'teacher')  AS mem_teacher,
  (SELECT count(*) FROM public.staff_members WHERE user_id IS NOT NULL)                   AS staff_teachers,
  (SELECT count(*) FROM public.teacher_assignments WHERE active = TRUE)                   AS teacher_assignments,
  (SELECT count(*) FROM public.students WHERE profile_id IS NOT NULL)                     AS students_with_login,
  (SELECT count(*) FROM public.parent_profiles WHERE profile_id IS NOT NULL)              AS parents_with_login;
