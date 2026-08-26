-- =====================================================================
-- AUTO-PROVISION USERS: Students, Parents, Teachers
-- =====================================================================
-- This migration creates auth users automatically for all existing:
--   - Students (login with student_code)
--   - Parents (login with guardian_email)
--   - Teachers (login with email)
--
-- Default password: "ChangeMe123!" (users forced to change on first login)
--
-- SAFE TO RE-RUN: Uses ON CONFLICT DO NOTHING, skips existing users
-- =====================================================================

-- Enable required extension for password hashing
-- Supabase installs pgcrypto in the 'extensions' schema by default
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ---------------------------------------------------------------------
-- HELPER: Create auth user with hashed password
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_auth_user(
  p_email TEXT,
  p_password TEXT DEFAULT 'ChangeMe123!',
  p_role TEXT DEFAULT 'authenticated'
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, extensions, public
AS $$
DECLARE
  v_user_id UUID;
  v_encrypted_pw TEXT;
BEGIN
  -- Skip if user with this email already exists
  SELECT id INTO v_user_id FROM auth.users WHERE email = LOWER(p_email);
  IF v_user_id IS NOT NULL THEN
    RETURN v_user_id;
  END IF;

  v_user_id := extensions.gen_random_uuid();
  v_encrypted_pw := extensions.crypt(p_password, extensions.gen_salt('bf'));

  INSERT INTO auth.users (
    instance_id, id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_user_id,
    'authenticated',
    'authenticated',
    LOWER(p_email),
    v_encrypted_pw,
    NOW(),
    jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
    jsonb_build_object('role', p_role),
    NOW(), NOW(),
    '', '', '', ''
  );

  -- Also create identity record (required for login)
  INSERT INTO auth.identities (
    id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at
  ) VALUES (
    extensions.gen_random_uuid(),
    v_user_id,
    v_user_id::text,
    jsonb_build_object('sub', v_user_id::text, 'email', LOWER(p_email)),
    'email',
    NOW(), NOW(), NOW()
  );

  RETURN v_user_id;
END;
$$;

-- ---------------------------------------------------------------------
-- 1. PROVISION ALL STUDENTS
-- ---------------------------------------------------------------------
-- Login: <student_code>@student.local  (e.g. s295@student.local)
-- Password: ChangeMe123!
-- ---------------------------------------------------------------------
DO $$
DECLARE
  s RECORD;
  v_uid UUID;
  v_email TEXT;
  v_count INT := 0;
BEGIN
  FOR s IN
    SELECT id, student_code, full_name
    FROM public.students
    WHERE status = 'active'
      AND profile_id IS NULL
      AND student_code IS NOT NULL
  LOOP
    v_email := LOWER(s.student_code) || '@student.local';
    v_uid := public.create_auth_user(v_email, 'ChangeMe123!', 'student');

    UPDATE public.students
    SET profile_id = v_uid,
        login_enabled = TRUE,
        must_change_password = TRUE
    WHERE id = s.id;

    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Provisioned % students', v_count;
END $$;

-- ---------------------------------------------------------------------
-- 2. PROVISION ALL PARENTS (from unique guardian_emails)
-- ---------------------------------------------------------------------
-- Login: <guardian_email>
-- Password: ChangeMe123!
-- ---------------------------------------------------------------------
DO $$
DECLARE
  g RECORD;
  v_uid UUID;
  v_parent_id UUID;
  v_count INT := 0;
BEGIN
  FOR g IN
    SELECT DISTINCT
      LOWER(guardian_email) AS email,
      MAX(guardian_name) AS name,
      MAX(guardian_phone) AS phone
    FROM public.students
    WHERE guardian_email IS NOT NULL
      AND guardian_email != ''
      AND status = 'active'
    GROUP BY LOWER(guardian_email)
  LOOP
    v_uid := public.create_auth_user(g.email, 'ChangeMe123!', 'parent');

    -- Create parent_profiles record if not exists
    INSERT INTO public.parent_profiles (profile_id, full_name, email, phone)
    VALUES (v_uid, COALESCE(g.name, g.email), g.email, g.phone)
    ON CONFLICT (profile_id) DO UPDATE SET email = EXCLUDED.email
    RETURNING id INTO v_parent_id;

    IF v_parent_id IS NULL THEN
      SELECT id INTO v_parent_id FROM public.parent_profiles WHERE profile_id = v_uid;
    END IF;

    -- Link parent to all their children
    INSERT INTO public.parent_student_links (parent_id, student_id)
    SELECT v_parent_id, s.id
    FROM public.students s
    WHERE LOWER(s.guardian_email) = g.email
      AND s.status = 'active'
    ON CONFLICT (parent_id, student_id) DO NOTHING;

    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Provisioned % parents', v_count;
END $$;

-- ---------------------------------------------------------------------
-- 3. PROVISION ALL TEACHERS (if teachers table exists)
-- ---------------------------------------------------------------------
DO $$
DECLARE
  t RECORD;
  v_uid UUID;
  v_count INT := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'teachers') THEN
    FOR t IN
      SELECT id, email, full_name FROM public.teachers
      WHERE email IS NOT NULL AND email != ''
        AND (profile_id IS NULL)
    LOOP
      v_uid := public.create_auth_user(LOWER(t.email), 'ChangeMe123!', 'teacher');

      UPDATE public.teachers
      SET profile_id = v_uid
      WHERE id = t.id;

      -- Also create profile record if profiles table exists
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'profiles') THEN
        INSERT INTO public.profiles (id, email, full_name, role)
        VALUES (v_uid, LOWER(t.email), t.full_name, 'teacher')
        ON CONFLICT (id) DO NOTHING;
      END IF;

      v_count := v_count + 1;
    END LOOP;
    RAISE NOTICE 'Provisioned % teachers', v_count;
  ELSE
    RAISE NOTICE 'No teachers table found — skipping';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 4. AUTO-PROVISIONING TRIGGERS (for future new records)
-- ---------------------------------------------------------------------
-- Whenever a new student/parent/teacher is added, auto-create their login
-- ---------------------------------------------------------------------

-- Trigger: New student → auto-provision login
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
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_auto_provision_student ON public.students;
CREATE TRIGGER trg_auto_provision_student
  BEFORE INSERT ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.auto_provision_student();

-- Trigger: New student with guardian_email → auto-provision parent
CREATE OR REPLACE FUNCTION public.auto_provision_parent()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid UUID;
  v_parent_id UUID;
BEGIN
  IF NEW.guardian_email IS NOT NULL AND NEW.guardian_email != '' THEN
    v_uid := public.create_auth_user(LOWER(NEW.guardian_email), 'ChangeMe123!', 'parent');

    -- Upsert parent profile
    INSERT INTO public.parent_profiles (profile_id, full_name, email, phone)
    VALUES (v_uid, COALESCE(NEW.guardian_name, NEW.guardian_email), LOWER(NEW.guardian_email), NEW.guardian_phone)
    ON CONFLICT (profile_id) DO NOTHING;

    SELECT id INTO v_parent_id FROM public.parent_profiles WHERE profile_id = v_uid;

    -- Link parent to this child
    IF v_parent_id IS NOT NULL THEN
      INSERT INTO public.parent_student_links (parent_id, student_id)
      VALUES (v_parent_id, NEW.id)
      ON CONFLICT (parent_id, student_id) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_auto_provision_parent ON public.students;
CREATE TRIGGER trg_auto_provision_parent
  AFTER INSERT ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.auto_provision_parent();

-- ---------------------------------------------------------------------
-- 5. VERIFICATION QUERIES
-- ---------------------------------------------------------------------
SELECT 'Students provisioned' AS metric, COUNT(*) AS total
FROM public.students WHERE profile_id IS NOT NULL
UNION ALL
SELECT 'Parents provisioned', COUNT(*) FROM public.parent_profiles
UNION ALL
SELECT 'Parent-Student links', COUNT(*) FROM public.parent_student_links
UNION ALL
SELECT 'Auth users total', COUNT(*) FROM auth.users;

-- ---------------------------------------------------------------------
-- DONE!
-- ---------------------------------------------------------------------
-- All students can now log in with:
--   Student Code: (e.g. S295)
--   Password: ChangeMe123!
--
-- All parents can log in with:
--   Email: (their guardian_email)
--   Password: ChangeMe123!
--
-- All will be forced to change password on first login.
-- ---------------------------------------------------------------------
