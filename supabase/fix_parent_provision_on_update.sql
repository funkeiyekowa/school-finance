-- ============================================================
-- FIX: auto_provision_parent should fire on UPDATE too
--
-- v2 — the first version tried to use ON CONFLICT (profile_id) on
--      parent_profiles, but that table has no such unique constraint.
--      This version:
--        - Adds a UNIQUE constraint on parent_profiles(profile_id)
--          (idempotent — checks pg_constraint first).
--        - Passes organization_id on every INSERT (parent_profiles
--          and parent_student_links both have NOT NULL org_id).
--        - Uses the same fallback pattern in the backfill.
--
-- Root cause of "parent password did not work":
--   trg_auto_provision_parent was AFTER INSERT ON students only, so
--   when an admin ADDED a guardian_email to an EXISTING student, no
--   auth user got created. The client couldn't tell — it showed
--   "Parent Portal account auto-provisioned" but the parent had no
--   login.
--
-- What this migration does:
--   0. Ensure UNIQUE (profile_id) on parent_profiles.
--   1. Rewrite public.auto_provision_parent() so INSERT and UPDATE
--      behave the same; UPDATE is a no-op when guardian_email did
--      not change.
--   2. Recreate trg_auto_provision_parent as
--        AFTER INSERT OR UPDATE OF guardian_email, guardian_name, guardian_phone.
--   3. Backfill every students row whose guardian_email points at
--      no auth user (e.g. Mrs Abudu / abudu@yahoo.com).
--   4. Verify at the end.
--
-- Idempotent. Safe to re-run.
-- Run in Supabase SQL editor.
-- ============================================================

-- ---------------------------------------------------------------------
-- 0. UNIQUE constraint on parent_profiles(profile_id)
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'parent_profiles_profile_id_key'
  ) THEN
    -- Purge duplicates first — keep the earliest row per profile_id.
    DELETE FROM public.parent_profiles pp
     WHERE pp.ctid <> (
       SELECT MIN(pp2.ctid) FROM public.parent_profiles pp2
        WHERE pp2.profile_id = pp.profile_id
     )
       AND pp.profile_id IS NOT NULL;

    -- Add the constraint. Nullable profile_id rows are still allowed.
    ALTER TABLE public.parent_profiles
      ADD CONSTRAINT parent_profiles_profile_id_key UNIQUE (profile_id);
  END IF;
END $$;

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
  IF v_email = '' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_old_email := LOWER(TRIM(COALESCE(OLD.guardian_email, '')));
    IF v_old_email = v_email THEN
      RETURN NEW;
    END IF;
  END IF;

  -- create_auth_user is idempotent: returns existing UUID if the email is already there.
  v_uid := public.create_auth_user(v_email, 'ChangeMe123!', 'parent');

  -- parent_profiles row
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

  -- Base profile row for the parent
  INSERT INTO public.profiles (id, email, full_name, role, organization_id)
  VALUES (v_uid, v_email, COALESCE(NEW.guardian_name, v_email), 'parent', NEW.organization_id)
  ON CONFLICT (id) DO UPDATE
    SET role            = COALESCE(public.profiles.role, 'parent'),
        organization_id = COALESCE(public.profiles.organization_id, EXCLUDED.organization_id);

  -- Auto-approve on whichever approval column exists
  BEGIN EXECUTE 'UPDATE public.profiles SET approved       = TRUE       WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN EXECUTE 'UPDATE public.profiles SET is_approved    = TRUE       WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN EXECUTE 'UPDATE public.profiles SET status         = ''active''   WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
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
-- 3. BACKFILL — every guardian_email that has no auth user yet
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

    INSERT INTO public.parent_profiles (organization_id, profile_id, full_name, email, phone)
    VALUES (r.organization_id, v_uid, COALESCE(r.guardian_name, r.email), r.email, r.guardian_phone)
    ON CONFLICT (profile_id) DO NOTHING;

    SELECT id INTO v_parent_id FROM public.parent_profiles WHERE profile_id = v_uid LIMIT 1;
    IF v_parent_id IS NOT NULL THEN
      INSERT INTO public.parent_student_links (organization_id, parent_id, student_id)
      VALUES (r.organization_id, v_parent_id, r.student_id)
      ON CONFLICT (parent_id, student_id) DO NOTHING;
    END IF;

    INSERT INTO public.profiles (id, email, full_name, role, organization_id)
    VALUES (v_uid, r.email, COALESCE(r.guardian_name, r.email), 'parent', r.organization_id)
    ON CONFLICT (id) DO UPDATE
      SET role            = COALESCE(public.profiles.role, 'parent'),
          organization_id = COALESCE(public.profiles.organization_id, EXCLUDED.organization_id);

    BEGIN EXECUTE 'UPDATE public.profiles SET approved       = TRUE       WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
    BEGIN EXECUTE 'UPDATE public.profiles SET is_approved    = TRUE       WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
    BEGIN EXECUTE 'UPDATE public.profiles SET status         = ''active''   WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
    BEGIN EXECUTE 'UPDATE public.profiles SET account_status = ''approved'' WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;

    RAISE NOTICE 'backfilled parent auth for %', r.email;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 4. VERIFY
-- ---------------------------------------------------------------------
SELECT 'parents_now_linked' AS metric,
       COUNT(*)             AS n
FROM auth.users u
JOIN public.parent_profiles p ON p.profile_id = u.id;

SELECT 'guardian_emails_still_unlinked' AS metric,
       COUNT(*)                          AS n
FROM public.students s
WHERE s.guardian_email IS NOT NULL
  AND TRIM(s.guardian_email) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM auth.users u
     WHERE LOWER(u.email) = LOWER(TRIM(s.guardian_email))
  );
