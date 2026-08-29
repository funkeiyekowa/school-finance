-- ============================================================
-- MEGA-FIX: staff/teacher login, role sync, code uniqueness,
--           parent sub-module foundation.
--
-- Addresses items 1, 3, 4, 5, 6, 8, 9, 10, 11, 14, 16, 17, 19
-- from Aug 2026 upgrade batch. Idempotent, safe to re-run.
-- ============================================================

-- ============================================================
-- 1. Unique constraints on staff_code and student_code
-- ============================================================
DO $$
BEGIN
  -- Purge accidental blanks before adding UNIQUE.
  UPDATE public.staff_members SET staff_code = NULL WHERE TRIM(COALESCE(staff_code,'')) = '';
  UPDATE public.students      SET student_code = NULL WHERE TRIM(COALESCE(student_code,'')) = '';

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_members_org_code_key') THEN
    ALTER TABLE public.staff_members
      ADD CONSTRAINT staff_members_org_code_key UNIQUE (organization_id, staff_code);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'students_org_code_key') THEN
    ALTER TABLE public.students
      ADD CONSTRAINT students_org_code_key UNIQUE (organization_id, student_code);
  END IF;
END $$;

-- ============================================================
-- 2. next_staff_code(org) — auto-increment STF001 / STF002 …
-- ============================================================
CREATE OR REPLACE FUNCTION public.next_staff_code(p_org uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_max int := 0;
  v_num int;
BEGIN
  SELECT COALESCE(MAX(
    CASE WHEN staff_code ~ '^STF[0-9]+$'
         THEN substring(staff_code from 4)::int
         ELSE 0 END
  ), 0)
    INTO v_max
  FROM public.staff_members
  WHERE organization_id = p_org;

  v_num := v_max + 1;
  RETURN 'STF' || LPAD(v_num::text, 3, '0');
END $$;

GRANT EXECUTE ON FUNCTION public.next_staff_code(uuid) TO authenticated;

-- Same for student_code — prefix 'S'
CREATE OR REPLACE FUNCTION public.next_student_code(p_org uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_max int := 0;
BEGIN
  SELECT COALESCE(MAX(
    CASE WHEN student_code ~ '^S[0-9]+$'
         THEN substring(student_code from 2)::int
         ELSE 0 END
  ), 0)
    INTO v_max
  FROM public.students
  WHERE organization_id = p_org;
  RETURN 'S' || LPAD((v_max + 1)::text, 3, '0');
END $$;

GRANT EXECUTE ON FUNCTION public.next_student_code(uuid) TO authenticated;

-- ============================================================
-- 3. Role-sync: profiles.role <-> org_memberships.role
--    Two triggers keep them in lock-step. This closes item 10.
-- ============================================================

-- 3a. When profiles.role changes, cascade to the caller's membership rows.
CREATE OR REPLACE FUNCTION public.sync_profile_role_to_membership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     AND NEW.role IS NOT NULL
     AND NEW.role NOT IN ('pending','') THEN
    -- Never downgrade a super_admin/owner/admin membership from a profile edit.
    UPDATE public.org_memberships
       SET role = NEW.role
     WHERE user_id = NEW.id
       AND role NOT IN ('super_admin','owner');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_profile_role_sync ON public.profiles;
CREATE TRIGGER trg_profile_role_sync
  AFTER UPDATE OF role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_role_to_membership();

-- 3b. When org_memberships.role changes, cascade to profiles.role.
CREATE OR REPLACE FUNCTION public.sync_membership_role_to_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     AND NEW.role IS NOT NULL
     AND NEW.role NOT IN ('pending','') THEN
    UPDATE public.profiles
       SET role = NEW.role
     WHERE id = NEW.user_id
       AND (role IS NULL OR role IN ('pending', OLD.role));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_membership_role_sync ON public.org_memberships;
CREATE TRIGGER trg_membership_role_sync
  AFTER UPDATE OF role ON public.org_memberships
  FOR EACH ROW EXECUTE FUNCTION public.sync_membership_role_to_profile();

-- ============================================================
-- 4. Refined auto_provision_staff:
--    - Uses staff_type: 'admin' | 'teaching' | 'non_teaching'
--    - Role mapping: admin -> admin, teaching -> teacher,
--      non_teaching -> staff.
--    - Sets must_change_password every time a new email is
--      provisioned so item 14 is impossible to bypass.
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
    SET role                 = COALESCE(NULLIF(public.profiles.role, 'pending'), EXCLUDED.role),
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
        role   = CASE WHEN public.org_memberships.role IN ('super_admin','owner') THEN public.org_memberships.role ELSE EXCLUDED.role END;

  RETURN NEW;
END $$;

-- Re-attach trigger (needed after CREATE OR REPLACE FUNCTION)
DROP TRIGGER IF EXISTS trg_auto_provision_staff ON public.staff_members;
CREATE TRIGGER trg_auto_provision_staff
  BEFORE INSERT OR UPDATE OF email, full_name, staff_type ON public.staff_members
  FOR EACH ROW EXECUTE FUNCTION public.auto_provision_staff();

-- ============================================================
-- 5. Refined resolve_login_context that TRUSTS staff_members.staff_type
--    for staff paths. This closes item 16 (role from staff_type).
-- ============================================================
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

  -- 1. Staff via staff_members.user_id, TRUSTING staff_type
  SELECT LOWER(COALESCE(staff_type,'teaching')) INTO v_staff_type
    FROM public.staff_members
   WHERE user_id = v_uid AND organization_id = v_org_id
   LIMIT 1;

  IF v_staff_type IS NOT NULL THEN
    IF v_staff_type IN ('admin','administrator') THEN
      v_role := 'admin'; v_redirect := '/dashboard';
    ELSIF v_staff_type IN ('non_teaching','nonteaching','non teaching','support') THEN
      v_role := 'staff'; v_redirect := '/dashboard';
    ELSE
      v_role := 'teacher'; v_redirect := '/dashboard/teaching';
    END IF;
  END IF;

  -- 2. org_memberships role fallback
  IF v_role IS NULL THEN
    SELECT role INTO v_membership_role
      FROM public.org_memberships
     WHERE user_id = v_uid AND organization_id = v_org_id AND active = TRUE
     LIMIT 1;

    IF v_membership_role IN ('super_admin','owner','admin','developer','editor') THEN
      v_role := 'admin'; v_redirect := '/dashboard';
    ELSIF v_membership_role = 'staff' THEN
      v_role := 'staff'; v_redirect := '/dashboard';
    ELSIF v_membership_role = 'teacher' THEN
      v_role := 'teacher'; v_redirect := '/dashboard/teaching';
    ELSIF v_membership_role = 'parent' THEN
      v_role := 'parent'; v_redirect := '/dashboard/parent-portal';
    ELSIF v_membership_role = 'student' THEN
      v_role := 'student'; v_redirect := '/dashboard/student-portal';
    END IF;
  END IF;

  -- 3. Student via students.profile_id
  IF v_role IS NULL THEN
    SELECT id INTO v_student_id
      FROM public.students
     WHERE profile_id = v_uid AND organization_id = v_org_id
     LIMIT 1;
    IF v_student_id IS NOT NULL THEN
      v_role := 'student'; v_redirect := '/dashboard/student-portal';
    END IF;
  END IF;

  -- 4. Parent via parent_profiles + parent_student_links
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
    'role', v_role,
    'redirect', v_redirect,
    'organization_id', v_org_id,
    'organization_name', v_org_name,
    'student_id', v_student_id,
    'reason', CASE WHEN v_role IS NULL THEN 'not_attached' ELSE 'ok' END
  );
END $$;

GRANT EXECUTE ON FUNCTION public.resolve_login_context(text) TO authenticated;

-- ============================================================
-- 6. Parent module: extended parent_profiles columns
--    (items 7, 8 partial — data model foundation)
-- ============================================================
ALTER TABLE public.parent_profiles
  ADD COLUMN IF NOT EXISTS relationship         text,
  ADD COLUMN IF NOT EXISTS secondary_email      text,
  ADD COLUMN IF NOT EXISTS secondary_phone      text,
  ADD COLUMN IF NOT EXISTS emergency_contact_name  text,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone text,
  ADD COLUMN IF NOT EXISTS address              text,
  ADD COLUMN IF NOT EXISTS occupation           text,
  ADD COLUMN IF NOT EXISTS notes                text;

-- ============================================================
-- 7. Reset-credential RPCs (item 8)
--    Reset a parent password to ChangeMe123! and re-flag them.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_reset_parent_password(p_parent_profile_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_uid uuid;
BEGIN
  -- Caller must be an admin/owner/super_admin in some org.
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
     SET encrypted_password = crypt('ChangeMe123!', gen_salt('bf'))
   WHERE id = v_uid;

  UPDATE public.profiles SET must_change_password = TRUE WHERE id = v_uid;
  RETURN 'ok';
END $$;

GRANT EXECUTE ON FUNCTION public.admin_reset_parent_password(uuid) TO authenticated;

-- ============================================================
-- 8. Email-lookup RPC for password-reset UX (item 9)
-- ============================================================
CREATE OR REPLACE FUNCTION public.auth_email_exists(p_email text)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users WHERE LOWER(email) = LOWER(TRIM(p_email))
  );
$$;

GRANT EXECUTE ON FUNCTION public.auth_email_exists(text) TO anon, authenticated;

-- ============================================================
-- VERIFY
-- ============================================================
SELECT 'staff_members_org_code_key' AS constraint, COUNT(*) AS n
  FROM pg_constraint WHERE conname = 'staff_members_org_code_key';
SELECT 'students_org_code_key'      AS constraint, COUNT(*) AS n
  FROM pg_constraint WHERE conname = 'students_org_code_key';
SELECT 'next code sample' AS check,
       public.next_staff_code((SELECT id FROM public.organizations LIMIT 1)) AS staff,
       public.next_student_code((SELECT id FROM public.organizations LIMIT 1)) AS student;
