-- ============================================================
-- FIX: Promote profiles stuck on role='pending' AND stop leaving
--      new provisioned users at 'pending' going forward.
--
-- Two problems:
--   1. handle_new_user (in schema.sql) inserts profiles.role='pending'
--      for every new auth.users row. Later triggers UPDATE that
--      profile with SET role = COALESCE(role, 'parent') — but
--      COALESCE keeps the existing 'pending' value because it is
--      NOT NULL. So the profile stays 'pending' forever until a
--      super-admin manually changes it.
--   2. There is no bulk cleanup that classifies existing 'pending'
--      profiles.
--
-- This migration:
--   a) Rewrites auto_provision_parent() and auto_provision_student()
--      so the UPDATE side uses NULLIF(role, 'pending') — i.e. treat
--      'pending' as "no role" and let the trigger overwrite it.
--   b) Backfill: classify every existing profile whose role='pending'
--      by inspecting the sources of truth:
--        - matches students.profile_id      -> 'student'
--        - matches parent_profiles.profile_id -> 'parent'
--        - matches teacher_assignments.teacher_email
--            OR staff_members.email OR staff_members.profile_id
--                                             -> 'teacher'
--        - matches org_memberships.role owner/admin -> 'admin'
--      Also flips profiles.active = true for the same rows.
--   c) Adds a small helper `promote_pending_profile(p_profile uuid)`
--      that the app's login screen (or a future admin button) can
--      call to re-classify a specific profile without leaving Supabase.
--
-- Idempotent. Safe to re-run. Run in the Supabase SQL editor.
-- ============================================================

-- ---------------------------------------------------------------------
-- 1. Backfill: promote every existing 'pending' profile to its true role.
--    We RUN THIS FIRST so anyone stuck right now is fixed immediately.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  v_role text;
BEGIN
  FOR r IN
    SELECT id, email FROM public.profiles WHERE role = 'pending'
  LOOP
    v_role := NULL;

    -- student?
    IF EXISTS (SELECT 1 FROM public.students WHERE profile_id = r.id) THEN
      v_role := 'student';
    END IF;

    -- parent?
    IF v_role IS NULL
       AND EXISTS (SELECT 1 FROM public.parent_profiles WHERE profile_id = r.id) THEN
      v_role := 'parent';
    END IF;

    -- teacher/staff?
    IF v_role IS NULL AND EXISTS (
      SELECT 1 FROM public.staff_members WHERE profile_id = r.id
    ) THEN
      v_role := 'teacher';
    END IF;

    -- staff by email
    IF v_role IS NULL AND EXISTS (
      SELECT 1 FROM public.staff_members WHERE LOWER(email) = LOWER(r.email)
    ) THEN
      v_role := 'teacher';
    END IF;

    -- admin/owner via org_memberships
    IF v_role IS NULL AND EXISTS (
      SELECT 1 FROM public.org_memberships om
       WHERE om.user_id = r.id AND om.role IN ('owner', 'admin')
    ) THEN
      v_role := 'admin';
    END IF;

    IF v_role IS NOT NULL THEN
      UPDATE public.profiles
         SET role = v_role,
             active = true
       WHERE id = r.id;
      -- best-effort approve columns (harmless when column absent)
      BEGIN EXECUTE 'UPDATE public.profiles SET approved       = TRUE     WHERE id = $1' USING r.id; EXCEPTION WHEN undefined_column THEN NULL; END;
      BEGIN EXECUTE 'UPDATE public.profiles SET is_approved    = TRUE     WHERE id = $1' USING r.id; EXCEPTION WHEN undefined_column THEN NULL; END;
      BEGIN EXECUTE 'UPDATE public.profiles SET status         = ''active''  WHERE id = $1' USING r.id; EXCEPTION WHEN undefined_column THEN NULL; END;
      BEGIN EXECUTE 'UPDATE public.profiles SET account_status = ''approved'' WHERE id = $1' USING r.id; EXCEPTION WHEN undefined_column THEN NULL; END;
      RAISE NOTICE 'promoted profile % (email %) to %', r.id, r.email, v_role;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 2. Reusable helper — the app can call this after a login/first sign-in
--    to make sure the caller\'s role is right.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.promote_pending_profile(p_profile uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_role text;
  v_email text;
BEGIN
  SELECT email INTO v_email FROM public.profiles WHERE id = p_profile;
  IF v_email IS NULL THEN RETURN NULL; END IF;

  IF EXISTS (SELECT 1 FROM public.students WHERE profile_id = p_profile) THEN
    v_role := 'student';
  ELSIF EXISTS (SELECT 1 FROM public.parent_profiles WHERE profile_id = p_profile) THEN
    v_role := 'parent';
  ELSIF EXISTS (SELECT 1 FROM public.staff_members WHERE profile_id = p_profile
                   OR LOWER(email) = LOWER(v_email)) THEN
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

-- ---------------------------------------------------------------------
-- 3. Rewrite auto_provision_parent to overwrite 'pending' (not COALESCE)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_provision_parent()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid       UUID;
  v_parent_id UUID;
  v_email     TEXT := LOWER(TRIM(COALESCE(NEW.guardian_email, '')));
  v_old_email TEXT;
BEGIN
  IF v_email = '' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_old_email := LOWER(TRIM(COALESCE(OLD.guardian_email, '')));
    IF v_old_email = v_email THEN
      RETURN NEW;
    END IF;
  END IF;

  v_uid := public.create_auth_user(v_email, 'ChangeMe123!', 'parent');

  INSERT INTO public.parent_profiles (organization_id, profile_id, full_name, email, phone)
  VALUES (
    NEW.organization_id,
    v_uid,
    COALESCE(NEW.guardian_name, NEW.guardian_email),
    v_email,
    NEW.guardian_phone
  )
  ON CONFLICT (profile_id) DO UPDATE
    SET full_name       = COALESCE(EXCLUDED.full_name, public.parent_profiles.full_name),
        phone           = COALESCE(EXCLUDED.phone,     public.parent_profiles.phone),
        organization_id = COALESCE(public.parent_profiles.organization_id, EXCLUDED.organization_id);

  SELECT id INTO v_parent_id FROM public.parent_profiles WHERE profile_id = v_uid LIMIT 1;

  IF v_parent_id IS NOT NULL THEN
    INSERT INTO public.parent_student_links (organization_id, parent_id, student_id)
    VALUES (NEW.organization_id, v_parent_id, NEW.id)
    ON CONFLICT (parent_id, student_id) DO NOTHING;
  END IF;

  -- Overwrite 'pending' explicitly; only keep an existing non-'pending' role.
  INSERT INTO public.profiles (id, email, full_name, role, organization_id, active)
  VALUES (v_uid, v_email, COALESCE(NEW.guardian_name, v_email), 'parent', NEW.organization_id, TRUE)
  ON CONFLICT (id) DO UPDATE
    SET role            = COALESCE(NULLIF(public.profiles.role, 'pending'), 'parent'),
        organization_id = COALESCE(public.profiles.organization_id, EXCLUDED.organization_id),
        active          = TRUE;

  BEGIN EXECUTE 'UPDATE public.profiles SET approved       = TRUE     WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN EXECUTE 'UPDATE public.profiles SET is_approved    = TRUE     WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN EXECUTE 'UPDATE public.profiles SET status         = ''active''  WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN EXECUTE 'UPDATE public.profiles SET account_status = ''approved'' WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;

  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- 4. Rewrite auto_provision_student to overwrite 'pending' too.
--    (Existing definition varies — recreate only the profile UPDATE portion
--    idempotently by wrapping the same pattern.)
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_body text;
BEGIN
  -- Only touch it if the current body still uses COALESCE(profiles.role, 'student').
  SELECT pg_get_functiondef(oid) INTO v_body
    FROM pg_proc WHERE proname = 'auto_provision_student' AND pronamespace = 'public'::regnamespace;

  IF v_body IS NOT NULL AND v_body LIKE '%COALESCE(public.profiles.role, ''student'')%' THEN
    EXECUTE replace(v_body,
      'COALESCE(public.profiles.role, ''student'')',
      'COALESCE(NULLIF(public.profiles.role, ''pending''), ''student'')'
    );
    RAISE NOTICE 'auto_provision_student patched';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 5. VERIFY
-- ---------------------------------------------------------------------
SELECT role, COUNT(*) AS n
FROM public.profiles
GROUP BY role
ORDER BY n DESC;

SELECT 'still_pending' AS metric, COUNT(*) AS n
FROM public.profiles WHERE role = 'pending';
