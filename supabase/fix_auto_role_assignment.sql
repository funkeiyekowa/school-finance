-- =====================================================================
-- FIX: Auto-assign roles to all provisioned users
-- =====================================================================
-- After auto_provision_users.sql runs, auth users exist but the app's
-- profiles table doesn't have role='student' / 'parent' / 'teacher' rows.
-- This migration:
--   1. Backfills profiles for every provisioned auth user with correct role
--   2. Adds a trigger so future new auth users auto-get a profile
--   3. Stores role in auth.users.raw_app_meta_data too (for client-side check)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Ensure profiles table has role column
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'role'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN role TEXT DEFAULT 'user';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. Backfill: Create profile for every student's auth user
-- ---------------------------------------------------------------------
INSERT INTO public.profiles (id, email, full_name, role, organization_id)
SELECT
  s.profile_id,
  LOWER(s.student_code) || '@student.local',
  s.full_name,
  'student',
  s.organization_id
FROM public.students s
WHERE s.profile_id IS NOT NULL
  AND s.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = s.profile_id)
ON CONFLICT (id) DO UPDATE SET role = 'student';

-- Update role for existing profiles that came from students
UPDATE public.profiles p
SET role = 'student',
    organization_id = COALESCE(p.organization_id, s.organization_id)
FROM public.students s
WHERE s.profile_id = p.id
  AND s.status = 'active'
  AND (p.role IS NULL OR p.role = 'user' OR p.role = 'authenticated');

-- ---------------------------------------------------------------------
-- 3. Backfill: Create profile for every parent's auth user
-- ---------------------------------------------------------------------
INSERT INTO public.profiles (id, email, full_name, role, organization_id)
SELECT
  pp.profile_id,
  pp.email,
  pp.full_name,
  'parent',
  (SELECT s.organization_id FROM public.students s
   JOIN public.parent_student_links psl ON psl.student_id = s.id
   WHERE psl.parent_id = pp.id LIMIT 1)
FROM public.parent_profiles pp
WHERE pp.profile_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = pp.profile_id)
ON CONFLICT (id) DO UPDATE SET role = 'parent';

-- Update role for existing profiles that came from parents
UPDATE public.profiles p
SET role = 'parent'
FROM public.parent_profiles pp
WHERE pp.profile_id = p.id
  AND (p.role IS NULL OR p.role = 'user' OR p.role = 'authenticated');

-- ---------------------------------------------------------------------
-- 4. Backfill: Teachers (if teachers table exists)
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'teachers') THEN
    INSERT INTO public.profiles (id, email, full_name, role, organization_id)
    SELECT t.profile_id, LOWER(t.email), t.full_name, 'teacher', t.organization_id
    FROM public.teachers t
    WHERE t.profile_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = t.profile_id)
    ON CONFLICT (id) DO UPDATE SET role = 'teacher';

    UPDATE public.profiles p
    SET role = 'teacher'
    FROM public.teachers t
    WHERE t.profile_id = p.id
      AND (p.role IS NULL OR p.role = 'user' OR p.role = 'authenticated');
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 5. Also stamp role into auth.users.raw_app_meta_data
-- ---------------------------------------------------------------------
-- This lets the client-side supabase.auth session know the role
-- without an extra profiles query
UPDATE auth.users u
SET raw_app_meta_data = COALESCE(u.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', p.role)
FROM public.profiles p
WHERE p.id = u.id AND p.role IS NOT NULL;

-- ---------------------------------------------------------------------
-- 6. TRIGGER: Any new profile → sync role to auth.users metadata
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_profile_role_to_auth()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.role IS NOT NULL THEN
    UPDATE auth.users
    SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', NEW.role)
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_profile_role ON public.profiles;
CREATE TRIGGER trg_sync_profile_role
  AFTER INSERT OR UPDATE OF role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_role_to_auth();

-- ---------------------------------------------------------------------
-- 7. UPDATE the student auto-provision trigger to also create profile
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_provision_student()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid UUID;
  v_email TEXT;
BEGIN
  IF NEW.profile_id IS NULL AND NEW.student_code IS NOT NULL AND NEW.status = 'active' THEN
    v_email := LOWER(NEW.student_code) || '@student.local';
    v_uid := public.create_auth_user(v_email, 'ChangeMe123!', 'student');
    NEW.profile_id := v_uid;
    NEW.login_enabled := TRUE;
    NEW.must_change_password := TRUE;

    -- Create profile with student role
    INSERT INTO public.profiles (id, email, full_name, role, organization_id)
    VALUES (v_uid, v_email, NEW.full_name, 'student', NEW.organization_id)
    ON CONFLICT (id) DO UPDATE SET role = 'student';
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- 8. UPDATE parent auto-provision trigger to also create profile
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_provision_parent()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid UUID;
  v_parent_id UUID;
BEGIN
  IF NEW.guardian_email IS NOT NULL AND NEW.guardian_email != '' THEN
    v_uid := public.create_auth_user(LOWER(NEW.guardian_email), 'ChangeMe123!', 'parent');

    INSERT INTO public.parent_profiles (profile_id, full_name, email, phone)
    VALUES (v_uid, COALESCE(NEW.guardian_name, NEW.guardian_email), LOWER(NEW.guardian_email), NEW.guardian_phone)
    ON CONFLICT (profile_id) DO NOTHING;

    SELECT id INTO v_parent_id FROM public.parent_profiles WHERE profile_id = v_uid;

    IF v_parent_id IS NOT NULL THEN
      INSERT INTO public.parent_student_links (parent_id, student_id)
      VALUES (v_parent_id, NEW.id)
      ON CONFLICT (parent_id, student_id) DO NOTHING;
    END IF;

    -- Create profile with parent role
    INSERT INTO public.profiles (id, email, full_name, role, organization_id)
    VALUES (v_uid, LOWER(NEW.guardian_email), COALESCE(NEW.guardian_name, NEW.guardian_email), 'parent', NEW.organization_id)
    ON CONFLICT (id) DO UPDATE SET role = COALESCE(profiles.role, 'parent');
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- 9. VERIFICATION
-- ---------------------------------------------------------------------
SELECT role, COUNT(*) AS user_count
FROM public.profiles
GROUP BY role
ORDER BY user_count DESC;

-- Should show something like:
--   student  | 245
--   parent   | 180
--   teacher  | 22
--   admin    | 3
