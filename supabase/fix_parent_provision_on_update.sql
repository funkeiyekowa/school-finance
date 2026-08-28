-- ============================================================
-- FIX: auto_provision_parent should fire on UPDATE too
--
-- Root cause of "parent password did not work":
--   The trg_auto_provision_parent trigger was AFTER INSERT ON students
--   only. So when an admin ADDS a guardian_email to an EXISTING student
--   (via the new Edit Guardian modal in the app), no auth user gets
--   created. The client shows "Parent Portal account auto-provisioned"
--   because it can't tell the trigger didn't fire — but the parent
--   really has no login.
--
-- This migration:
--   1. Rewrites auto_provision_parent() so it treats INSERT and UPDATE
--      the same, and is a no-op when guardian_email did not actually
--      change on UPDATE (so re-saving other fields on a student does
--      not try to create duplicate auth users).
--   2. Replaces the trigger definition with AFTER INSERT OR UPDATE.
--   3. Backfills every existing student whose guardian_email points to
--      NO auth user (i.e. was added after the original migration ran).
--   4. Verifies at the end — reports how many parents now exist and
--      whether any guardian_emails are still unlinked.
--
-- Idempotent. Safe to re-run. Run in Supabase SQL editor.
-- ============================================================

-- ---------------------------------------------------------------------
-- 1. FUNCTION
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_provision_parent()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid       UUID;
  v_parent_id UUID;
  v_email     TEXT := LOWER(TRIM(COALESCE(NEW.guardian_email, '')));
  v_old_email TEXT;
BEGIN
  -- Nothing to do if there is no guardian_email now.
  IF v_email = '' THEN
    RETURN NEW;
  END IF;

  -- On UPDATE, do nothing when the email did not actually change.
  IF TG_OP = 'UPDATE' THEN
    v_old_email := LOWER(TRIM(COALESCE(OLD.guardian_email, '')));
    IF v_old_email = v_email THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Create (or find) the auth user.  create_auth_user is idempotent —
  -- if the email already exists it just returns the existing UUID.
  v_uid := public.create_auth_user(v_email, 'ChangeMe123!', 'parent');

  -- Parent profile row
  INSERT INTO public.parent_profiles (profile_id, full_name, email, phone)
  VALUES (
    v_uid,
    COALESCE(NEW.guardian_name, NEW.guardian_email),
    v_email,
    NEW.guardian_phone
  )
  ON CONFLICT (profile_id) DO UPDATE
    SET full_name = COALESCE(EXCLUDED.full_name, public.parent_profiles.full_name),
        phone     = COALESCE(EXCLUDED.phone,     public.parent_profiles.phone);

  SELECT id INTO v_parent_id FROM public.parent_profiles WHERE profile_id = v_uid;

  IF v_parent_id IS NOT NULL THEN
    INSERT INTO public.parent_student_links (parent_id, student_id)
    VALUES (v_parent_id, NEW.id)
    ON CONFLICT (parent_id, student_id) DO NOTHING;
  END IF;

  -- Base profile row for the parent (portal reads from profiles.role)
  INSERT INTO public.profiles (id, email, full_name, role, organization_id)
  VALUES (v_uid, v_email, COALESCE(NEW.guardian_name, v_email), 'parent', NEW.organization_id)
  ON CONFLICT (id) DO UPDATE
    SET role            = COALESCE(public.profiles.role, 'parent'),
        organization_id = COALESCE(public.profiles.organization_id, EXCLUDED.organization_id);

  -- Auto-approve on whichever approval column exists (harmless if absent)
  BEGIN EXECUTE 'UPDATE public.profiles SET approved       = TRUE     WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN EXECUTE 'UPDATE public.profiles SET is_approved    = TRUE     WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN EXECUTE 'UPDATE public.profiles SET status         = ''active''  WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN EXECUTE 'UPDATE public.profiles SET account_status = ''approved'' WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;

  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- 2. TRIGGER — INSERT OR UPDATE
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_auto_provision_parent ON public.students;
CREATE TRIGGER trg_auto_provision_parent
  AFTER INSERT OR UPDATE OF guardian_email, guardian_name, guardian_phone
  ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.auto_provision_parent();

-- ---------------------------------------------------------------------
-- 3. BACKFILL — any guardian_email not currently linked to an auth user
-- ---------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  v_uid UUID;
  v_parent_id UUID;
BEGIN
  FOR r IN
    SELECT DISTINCT
           s.id                            AS student_id,
           s.organization_id,
           LOWER(TRIM(s.guardian_email))   AS email,
           s.guardian_name,
           s.guardian_phone
    FROM public.students s
    WHERE s.guardian_email IS NOT NULL
      AND TRIM(s.guardian_email) <> ''
      AND NOT EXISTS (
        SELECT 1 FROM auth.users u
         WHERE LOWER(u.email) = LOWER(TRIM(s.guardian_email))
      )
  LOOP
    v_uid := public.create_auth_user(r.email, 'ChangeMe123!', 'parent');

    INSERT INTO public.parent_profiles (profile_id, full_name, email, phone)
    VALUES (v_uid, COALESCE(r.guardian_name, r.email), r.email, r.guardian_phone)
    ON CONFLICT (profile_id) DO NOTHING;

    SELECT id INTO v_parent_id FROM public.parent_profiles WHERE profile_id = v_uid;
    IF v_parent_id IS NOT NULL THEN
      INSERT INTO public.parent_student_links (parent_id, student_id)
      VALUES (v_parent_id, r.student_id)
      ON CONFLICT (parent_id, student_id) DO NOTHING;
    END IF;

    INSERT INTO public.profiles (id, email, full_name, role, organization_id)
    VALUES (v_uid, r.email, COALESCE(r.guardian_name, r.email), 'parent', r.organization_id)
    ON CONFLICT (id) DO UPDATE
      SET role            = COALESCE(public.profiles.role, 'parent'),
          organization_id = COALESCE(public.profiles.organization_id, EXCLUDED.organization_id);

    BEGIN EXECUTE 'UPDATE public.profiles SET approved       = TRUE     WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
    BEGIN EXECUTE 'UPDATE public.profiles SET is_approved    = TRUE     WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
    BEGIN EXECUTE 'UPDATE public.profiles SET status         = ''active''  WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
    BEGIN EXECUTE 'UPDATE public.profiles SET account_status = ''approved'' WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;

    RAISE NOTICE 'backfilled parent auth for %', r.email;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 4. VERIFY
-- ---------------------------------------------------------------------
SELECT 'parents now linked' AS metric,
       COUNT(*) AS n
FROM auth.users u
JOIN public.parent_profiles p ON p.profile_id = u.id;

SELECT 'guardian_emails still unlinked' AS metric,
       COUNT(*) AS n
FROM public.students s
WHERE s.guardian_email IS NOT NULL
  AND TRIM(s.guardian_email) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM auth.users u
     WHERE LOWER(u.email) = LOWER(TRIM(s.guardian_email))
  );
