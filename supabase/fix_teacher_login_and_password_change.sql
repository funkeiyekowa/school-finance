-- ============================================================
-- FIX: Teacher auto-provisioning + forced password change +
--      parent portal linkage repair.
--
-- Symptoms this addresses:
--  1. A teacher added via Staff Directory can't log in — because
--     staff_members had no auth user tied to it.
--  2. Parents who "reset password" then loop back to login — the
--     ChangeMe123! default is on their auth account and their
--     parent_profiles → parent_student_links chain is intact,
--     but they're never told to change the password, so the app
--     treats them as attached and immediately redirects them to
--     a portal that then shows the fresh login form again.
--  3. Students CAN log in with the default password because their
--     student.local email domain never triggers a Supabase auth
--     email-reset flow.
--
-- Design:
--  A. staff_members gains a user_id UUID -> auth.users. Every
--     insert/update automatically provisions the auth user (via
--     existing create_auth_user helper).
--  B. profiles.must_change_password bool DEFAULT FALSE. Set to
--     TRUE on every auto-provision path. Cleared by the app when
--     the user completes the change-password screen.
--  C. Teacher role is added to org_memberships automatically so
--     resolve_login_context finds them on the first try.
--  D. Backfill: every existing staff_members.email with no auth
--     user gets one (password ChangeMe123!, must_change_password
--     TRUE, org_memberships row).
--  E. Backfill: every parent_profiles.profile_id with a matching
--     student link but no org_memberships row gets one, so parent
--     login stops "rolling".
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ============================================================
-- 0. Add columns
-- ============================================================
ALTER TABLE public.staff_members
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS staff_members_user_id_idx ON public.staff_members(user_id);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT FALSE;

-- ============================================================
-- 1. Auto-provision trigger for staff_members
--    Every insert/update with an email creates the auth user
--    (idempotent), attaches it to staff_members.user_id, ensures
--    a org_memberships row (role=teacher or non_teaching),
--    seeds profiles, and marks must_change_password.
-- ============================================================
CREATE OR REPLACE FUNCTION public.auto_provision_staff()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid   UUID;
  v_email TEXT := LOWER(TRIM(COALESCE(NEW.email, '')));
  v_role  TEXT;
BEGIN
  IF v_email = '' THEN
    RETURN NEW;
  END IF;

  -- create_auth_user is idempotent: returns existing UUID if the email is already there.
  v_uid := public.create_auth_user(v_email, 'ChangeMe123!', 'teacher');
  NEW.user_id := v_uid;

  -- staff_type: teaching -> teacher; anything else -> staff (non-teaching)
  v_role := CASE WHEN LOWER(COALESCE(NEW.staff_type, 'teaching')) = 'teaching' THEN 'teacher' ELSE 'staff' END;

  -- Base profile row.
  INSERT INTO public.profiles (id, email, full_name, role, organization_id, must_change_password)
  VALUES (v_uid, v_email, COALESCE(NEW.full_name, v_email), v_role, NEW.organization_id, TRUE)
  ON CONFLICT (id) DO UPDATE
    SET role                 = COALESCE(NULLIF(public.profiles.role, 'pending'), EXCLUDED.role),
        organization_id      = COALESCE(public.profiles.organization_id, EXCLUDED.organization_id),
        full_name            = COALESCE(public.profiles.full_name, EXCLUDED.full_name),
        must_change_password = COALESCE(public.profiles.must_change_password, TRUE);

  -- Approval flags on whichever exist.
  BEGIN EXECUTE 'UPDATE public.profiles SET active = TRUE WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN EXECUTE 'UPDATE public.profiles SET approved = TRUE WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN EXECUTE 'UPDATE public.profiles SET is_approved = TRUE WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN EXECUTE 'UPDATE public.profiles SET status = ''active'' WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN EXECUTE 'UPDATE public.profiles SET account_status = ''approved'' WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;

  -- org_memberships so resolve_login_context finds them immediately.
  INSERT INTO public.org_memberships (user_id, organization_id, role, is_default, active)
  VALUES (v_uid, NEW.organization_id, v_role, TRUE, TRUE)
  ON CONFLICT (user_id, organization_id) DO UPDATE
    SET active = TRUE,
        role   = CASE WHEN public.org_memberships.role IN ('super_admin','owner','admin') THEN public.org_memberships.role ELSE EXCLUDED.role END;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_auto_provision_staff ON public.staff_members;
CREATE TRIGGER trg_auto_provision_staff
  BEFORE INSERT OR UPDATE OF email, full_name, staff_type ON public.staff_members
  FOR EACH ROW EXECUTE FUNCTION public.auto_provision_staff();

-- ============================================================
-- 2. Backfill every existing staff_member without an auth link.
-- ============================================================
DO $$
DECLARE
  r RECORD;
  v_uid uuid;
  v_role text;
BEGIN
  FOR r IN
    SELECT id, email, full_name, staff_type, organization_id
    FROM public.staff_members
    WHERE email IS NOT NULL
      AND TRIM(email) <> ''
      AND user_id IS NULL
  LOOP
    v_uid := public.create_auth_user(LOWER(TRIM(r.email)), 'ChangeMe123!', 'teacher');
    v_role := CASE WHEN LOWER(COALESCE(r.staff_type, 'teaching')) = 'teaching' THEN 'teacher' ELSE 'staff' END;

    UPDATE public.staff_members SET user_id = v_uid WHERE id = r.id;

    INSERT INTO public.profiles (id, email, full_name, role, organization_id, must_change_password)
    VALUES (v_uid, LOWER(TRIM(r.email)), COALESCE(r.full_name, r.email), v_role, r.organization_id, TRUE)
    ON CONFLICT (id) DO UPDATE
      SET role                 = COALESCE(NULLIF(public.profiles.role, 'pending'), EXCLUDED.role),
          organization_id      = COALESCE(public.profiles.organization_id, EXCLUDED.organization_id),
          full_name            = COALESCE(public.profiles.full_name, EXCLUDED.full_name),
          must_change_password = TRUE;

    BEGIN EXECUTE 'UPDATE public.profiles SET active = TRUE WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
    BEGIN EXECUTE 'UPDATE public.profiles SET approved = TRUE WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
    BEGIN EXECUTE 'UPDATE public.profiles SET is_approved = TRUE WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
    BEGIN EXECUTE 'UPDATE public.profiles SET status = ''active'' WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;
    BEGIN EXECUTE 'UPDATE public.profiles SET account_status = ''approved'' WHERE id = $1' USING v_uid; EXCEPTION WHEN undefined_column THEN NULL; END;

    INSERT INTO public.org_memberships (user_id, organization_id, role, is_default, active)
    VALUES (v_uid, r.organization_id, v_role, TRUE, TRUE)
    ON CONFLICT (user_id, organization_id) DO UPDATE
      SET active = TRUE,
          role   = CASE WHEN public.org_memberships.role IN ('super_admin','owner','admin') THEN public.org_memberships.role ELSE EXCLUDED.role END;

    RAISE NOTICE 'backfilled staff auth for %', r.email;
  END LOOP;
END $$;

-- ============================================================
-- 3. Mark every existing parent's profile must_change_password=TRUE
--    (they were auto-provisioned with ChangeMe123!). Skip anyone
--    who has already changed it (heuristic: if last_sign_in_at
--    exists AND updated_at > created_at + 5 minutes, leave alone).
--
--    We don't have easy access to auth.users.updated_at reliably,
--    so we take the safe route: mark TRUE for anyone whose profile
--    was auto-provisioned. The change-password screen clears it.
-- ============================================================
UPDATE public.profiles
   SET must_change_password = TRUE
 WHERE role IN ('parent','teacher','staff')
   AND must_change_password = FALSE
   AND id IN (
     SELECT id FROM auth.users
     WHERE last_sign_in_at IS NULL
        OR encrypted_password IS NOT NULL  -- we can't tell what password they have; be conservative
   );

-- ============================================================
-- 4. Backfill missing org_memberships for parents so
--    resolve_login_context doesn't return NULL for them.
-- ============================================================
INSERT INTO public.org_memberships (user_id, organization_id, role, is_default, active)
SELECT DISTINCT pp.profile_id, s.organization_id, 'parent', TRUE, TRUE
  FROM public.parent_profiles pp
  JOIN public.parent_student_links psl ON psl.parent_id = pp.id
  JOIN public.students s ON s.id = psl.student_id
 WHERE pp.profile_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.org_memberships om
      WHERE om.user_id = pp.profile_id
        AND om.organization_id = s.organization_id
   )
ON CONFLICT (user_id, organization_id) DO UPDATE SET active = TRUE;

-- ============================================================
-- 5. RPC to clear must_change_password after a user updates it.
-- ============================================================
CREATE OR REPLACE FUNCTION public.clear_must_change_password()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not signed in';
  END IF;
  UPDATE public.profiles
     SET must_change_password = FALSE
   WHERE id = auth.uid();
END $$;

GRANT EXECUTE ON FUNCTION public.clear_must_change_password() TO authenticated;

-- ============================================================
-- 6. VERIFY
-- ============================================================
SELECT 'staff with auth' AS metric, COUNT(*) AS n
FROM public.staff_members WHERE user_id IS NOT NULL;

SELECT 'staff without auth (email missing)' AS metric, COUNT(*) AS n
FROM public.staff_members WHERE user_id IS NULL AND (email IS NULL OR TRIM(email) = '');

SELECT 'parents linked to memberships' AS metric, COUNT(*) AS n
FROM public.parent_profiles pp
JOIN public.org_memberships om ON om.user_id = pp.profile_id
WHERE om.role = 'parent';

SELECT 'must_change_password totals' AS metric,
       COUNT(*) FILTER (WHERE must_change_password) AS n_true,
       COUNT(*) FILTER (WHERE NOT must_change_password) AS n_false
  FROM public.profiles;
