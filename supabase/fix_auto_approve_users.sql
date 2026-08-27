-- =====================================================================
-- FIX: Auto-approve provisioned users (students, parents, teachers)
-- =====================================================================
-- Random self-registration users go through admin approval.
-- But students/parents/teachers ARE created by the school itself,
-- so they should skip the "Waiting for approval" screen.
--
-- This migration:
--   1. Detects which approval column exists (approved / status / is_approved)
--   2. Auto-approves all existing provisioned profiles
--   3. Updates the auto-provision triggers so FUTURE users skip approval too
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Discover what approval columns exist and auto-approve
-- ---------------------------------------------------------------------
DO $$
DECLARE
  col_exists BOOLEAN;
BEGIN
  -- Check for a boolean "approved" column
  SELECT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name='approved'
  ) INTO col_exists;

  IF col_exists THEN
    EXECUTE 'UPDATE public.profiles SET approved = TRUE
             WHERE role IN (''student'', ''parent'', ''teacher'')';
    RAISE NOTICE 'Auto-approved via profiles.approved column';
  END IF;

  -- Check for is_approved
  SELECT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name='is_approved'
  ) INTO col_exists;

  IF col_exists THEN
    EXECUTE 'UPDATE public.profiles SET is_approved = TRUE
             WHERE role IN (''student'', ''parent'', ''teacher'')';
    RAISE NOTICE 'Auto-approved via profiles.is_approved column';
  END IF;

  -- Check for status column
  SELECT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name='status'
  ) INTO col_exists;

  IF col_exists THEN
    EXECUTE 'UPDATE public.profiles SET status = ''active''
             WHERE role IN (''student'', ''parent'', ''teacher'')';
    RAISE NOTICE 'Auto-approved via profiles.status column';
  END IF;

  -- Check for account_status
  SELECT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name='account_status'
  ) INTO col_exists;

  IF col_exists THEN
    EXECUTE 'UPDATE public.profiles SET account_status = ''approved''
             WHERE role IN (''student'', ''parent'', ''teacher'')';
    RAISE NOTICE 'Auto-approved via profiles.account_status column';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. Auto-approve via organization_members table (if it exists)
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_name='organization_members') THEN

    -- Approve column
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='organization_members' AND column_name='approved') THEN
      EXECUTE 'UPDATE public.organization_members SET approved = TRUE
               WHERE profile_id IN (SELECT id FROM public.profiles
                                    WHERE role IN (''student'',''parent'',''teacher''))';
    END IF;

    -- Status column
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='organization_members' AND column_name='status') THEN
      EXECUTE 'UPDATE public.organization_members SET status = ''active''
               WHERE profile_id IN (SELECT id FROM public.profiles
                                    WHERE role IN (''student'',''parent'',''teacher''))';
    END IF;

    -- Insert org membership for those missing one (link via student/parent tables)
    -- Students
    EXECUTE 'INSERT INTO public.organization_members (profile_id, organization_id, role)
             SELECT s.profile_id, s.organization_id, ''student''
             FROM public.students s
             WHERE s.profile_id IS NOT NULL
               AND s.organization_id IS NOT NULL
               AND s.status = ''active''
               AND NOT EXISTS (SELECT 1 FROM public.organization_members om
                               WHERE om.profile_id = s.profile_id
                                 AND om.organization_id = s.organization_id)
             ON CONFLICT DO NOTHING';

    RAISE NOTICE 'Synced organization_members for students';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3. Auto-approve via user_organizations table (alternative naming)
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_name='user_organizations') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='user_organizations' AND column_name='approved') THEN
      EXECUTE 'UPDATE public.user_organizations SET approved = TRUE
               WHERE user_id IN (SELECT id FROM public.profiles
                                 WHERE role IN (''student'',''parent'',''teacher''))';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='user_organizations' AND column_name='status') THEN
      EXECUTE 'UPDATE public.user_organizations SET status = ''active''
               WHERE user_id IN (SELECT id FROM public.profiles
                                 WHERE role IN (''student'',''parent'',''teacher''))';
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 4. Update student auto-provision trigger to also auto-approve
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

    -- Auto-approve on all possible approval columns (harmless if column missing)
    BEGIN EXECUTE 'UPDATE public.profiles SET approved = TRUE WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
    BEGIN EXECUTE 'UPDATE public.profiles SET is_approved = TRUE WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
    BEGIN EXECUTE 'UPDATE public.profiles SET status = ''active'' WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
    BEGIN EXECUTE 'UPDATE public.profiles SET account_status = ''approved'' WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- 5. Update parent auto-provision trigger to also auto-approve
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

    -- Auto-approve on all possible approval columns
    BEGIN EXECUTE 'UPDATE public.profiles SET approved = TRUE WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
    BEGIN EXECUTE 'UPDATE public.profiles SET is_approved = TRUE WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
    BEGIN EXECUTE 'UPDATE public.profiles SET status = ''active'' WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
    BEGIN EXECUTE 'UPDATE public.profiles SET account_status = ''approved'' WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- 6. VERIFICATION — check what columns exist and current approval state
-- ---------------------------------------------------------------------
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema='public' AND table_name='profiles'
  AND column_name IN ('approved','is_approved','status','account_status','role')
ORDER BY column_name;

-- Show role + approval status count
SELECT role, COUNT(*) AS total FROM public.profiles GROUP BY role ORDER BY total DESC;

-- ---------------------------------------------------------------------
-- DONE! All existing students/parents/teachers auto-approved.
-- Future new students/parents added by admin will also auto-approve.
-- ---------------------------------------------------------------------
