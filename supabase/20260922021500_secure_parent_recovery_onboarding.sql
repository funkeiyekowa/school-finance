-- Run after fix_parent_provision_on_update.sql, fix_parent_reset_and_team_sync.sql,
-- fix_staff_login_and_roles.sql, and 20260921120000_phase1_guard_v2.sql.
--
-- SECURITY: parent accounts must never receive a shared or disclosed password.
-- New accounts receive an unguessable per-account secret that is discarded; the
-- guardian establishes a password through the existing generic recovery flow.
-- Existing parent passwords are preserved unless their bcrypt hash still verifies
-- against the historical shared password, in which case only that account is rotated.
--
-- Rollback: function definitions may be restored from the earlier migrations, but
-- rotated passwords cannot and must not be restored to the shared value. Guardians
-- affected by a rollback must continue through password recovery.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public._secure_recovery_secret()
RETURNS text
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT encode(extensions.gen_random_bytes(32), 'base64');
$$;
REVOKE ALL ON FUNCTION public._secure_recovery_secret() FROM PUBLIC, anon, authenticated;

-- Remove the legacy org-agnostic wrapper. The replacement requires the active
-- organization explicitly and verifies that the caller administers that tenant.
DROP FUNCTION IF EXISTS public.admin_create_parent_user(text);
CREATE OR REPLACE FUNCTION public.admin_create_parent_user(
  p_email text,
  p_organization_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_email text := lower(trim(coalesce(p_email, '')));
  v_uid uuid;
  v_created boolean := false;
BEGIN
  IF v_email = '' OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'A valid email is required';
  END IF;

  IF p_organization_id IS NULL
     OR p_organization_id IS DISTINCT FROM public.current_user_org_id()
     OR NOT public.is_org_admin(p_organization_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  SELECT u.id INTO v_uid
    FROM auth.users u
   WHERE lower(u.email) = v_email
   LIMIT 1;

  IF v_uid IS NULL THEN
    v_uid := public.create_auth_user(v_email, public._secure_recovery_secret(), 'parent');
    v_created := true;
  END IF;

  INSERT INTO public.profiles (id, email, role, organization_id, must_change_password)
  VALUES (v_uid, v_email, 'parent', p_organization_id, v_created)
  ON CONFLICT (id) DO UPDATE
    SET role = CASE
                 WHEN public.profiles.role IS NULL OR public.profiles.role = 'pending' THEN 'parent'
                 ELSE public.profiles.role
               END,
        organization_id = COALESCE(public.profiles.organization_id, EXCLUDED.organization_id),
        must_change_password = CASE
          WHEN v_created THEN true
          ELSE public.profiles.must_change_password
        END;

  RETURN v_uid;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_create_parent_user(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_parent_user(text, uuid) TO authenticated;

-- Student edits may auto-provision a guardian. Use the same discarded random
-- secret and preserve existing users' passwords.
CREATE OR REPLACE FUNCTION public.auto_provision_parent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_uid uuid;
  v_parent_id uuid;
  v_email text := lower(trim(coalesce(NEW.guardian_email, '')));
  v_old_email text;
  v_created boolean := false;
BEGIN
  IF v_email = '' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_old_email := lower(trim(coalesce(OLD.guardian_email, '')));
    IF v_old_email = v_email THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT u.id INTO v_uid
    FROM auth.users u
   WHERE lower(u.email) = v_email
   LIMIT 1;

  IF v_uid IS NULL THEN
    v_uid := public.create_auth_user(v_email, public._secure_recovery_secret(), 'parent');
    v_created := true;
  END IF;

  INSERT INTO public.parent_profiles (organization_id, profile_id, full_name, email, phone)
  VALUES (
    NEW.organization_id,
    v_uid,
    coalesce(NEW.guardian_name, NEW.guardian_email),
    v_email,
    NEW.guardian_phone
  )
  ON CONFLICT (profile_id) DO UPDATE
    SET full_name = coalesce(EXCLUDED.full_name, public.parent_profiles.full_name),
        phone = coalesce(EXCLUDED.phone, public.parent_profiles.phone),
        organization_id = coalesce(public.parent_profiles.organization_id, EXCLUDED.organization_id);

  SELECT pp.id INTO v_parent_id
    FROM public.parent_profiles pp
   WHERE pp.profile_id = v_uid
     AND pp.organization_id = NEW.organization_id
   LIMIT 1;

  IF v_parent_id IS NOT NULL THEN
    INSERT INTO public.parent_student_links (organization_id, parent_id, student_id)
    VALUES (NEW.organization_id, v_parent_id, NEW.id)
    ON CONFLICT (parent_id, student_id) DO NOTHING;
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role, organization_id, must_change_password)
  VALUES (
    v_uid,
    v_email,
    coalesce(NEW.guardian_name, v_email),
    'parent',
    NEW.organization_id,
    v_created
  )
  ON CONFLICT (id) DO UPDATE
    SET role = CASE
                 WHEN public.profiles.role IS NULL OR public.profiles.role = 'pending' THEN 'parent'
                 ELSE public.profiles.role
               END,
        organization_id = coalesce(public.profiles.organization_id, EXCLUDED.organization_id),
        must_change_password = CASE
          WHEN v_created THEN true
          ELSE public.profiles.must_change_password
        END;

  BEGIN EXECUTE 'UPDATE public.profiles SET approved = TRUE WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN EXECUTE 'UPDATE public.profiles SET is_approved = TRUE WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN EXECUTE 'UPDATE public.profiles SET status = ''active'' WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN EXECUTE 'UPDATE public.profiles SET account_status = ''approved'' WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_provision_parent ON public.students;
CREATE TRIGGER trg_auto_provision_parent
  AFTER INSERT OR UPDATE OF guardian_email, guardian_name, guardian_phone
  ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.auto_provision_parent();

-- Admin reset now invalidates the current password with a discarded random
-- secret. It never returns or exposes a usable credential. The guardian must
-- request a recovery link through /auth/forgot-password.
CREATE OR REPLACE FUNCTION public.admin_reset_parent_password(p_parent_profile_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_org uuid := public.current_user_org_id();
  v_uid uuid;
BEGIN
  IF v_org IS NULL OR NOT public.is_org_admin(v_org) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  SELECT pp.profile_id INTO v_uid
    FROM public.parent_profiles pp
   WHERE pp.id = p_parent_profile_id
     AND pp.organization_id = v_org
   LIMIT 1;

  IF v_uid IS NULL THEN
    RETURN 'not_found';
  END IF;

  UPDATE auth.users
     SET encrypted_password = extensions.crypt(
           public._secure_recovery_secret(),
           extensions.gen_salt('bf')
         ),
         updated_at = now()
   WHERE id = v_uid;

  UPDATE public.profiles
     SET must_change_password = true,
         updated_at = now()
   WHERE id = v_uid;

  RETURN 'recovery_required';
END;
$$;
REVOKE ALL ON FUNCTION public.admin_reset_parent_password(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reset_parent_password(uuid) TO authenticated;

-- Rotate only parent identities that still use the historical shared hash.
-- Passwords already changed by guardians do not match and remain untouched.
DO $$
DECLARE
  v_uid uuid;
  v_rotated integer := 0;
BEGIN
  FOR v_uid IN
    SELECT DISTINCT u.id
      FROM auth.users u
      JOIN public.parent_profiles pp ON pp.profile_id = u.id
     WHERE u.encrypted_password IS NOT NULL
       AND u.encrypted_password = extensions.crypt('ChangeMe123!', u.encrypted_password)
  LOOP
    UPDATE auth.users
       SET encrypted_password = extensions.crypt(
             public._secure_recovery_secret(),
             extensions.gen_salt('bf')
           ),
           updated_at = now()
     WHERE id = v_uid;

    UPDATE public.profiles
       SET must_change_password = true,
           updated_at = now()
     WHERE id = v_uid;

    v_rotated := v_rotated + 1;
  END LOOP;

  RAISE NOTICE 'Rotated % parent account(s) still using the historical shared password', v_rotated;
END;
$$;

COMMIT;

-- Verification: must return zero after a successful migration.
SELECT count(*) AS parent_accounts_still_using_historical_shared_password
  FROM auth.users u
  JOIN public.parent_profiles pp ON pp.profile_id = u.id
 WHERE u.encrypted_password IS NOT NULL
   AND u.encrypted_password = extensions.crypt('ChangeMe123!', u.encrypted_password);
