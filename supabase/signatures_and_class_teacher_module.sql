-- ====================================================================
-- SIGNATURES + CLASS TEACHER MODULE
-- =====================================================================
-- Adds two independent features:
--
--   1. E-signatures for printable letters (item 9). A school can store
--      multiple named signature images (Principal, Bursar, HR, ...)
--      and pick which one (or none) is the default for each letter
--      type (payslip, report_card, admission_letter, ...). Fully
--      optional -- a letter type with no default configured keeps
--      printing the existing blank underline placeholder, unchanged.
--      Reuses the existing "profile-photos" public storage bucket
--      (org-prefix write, public read) rather than creating a new
--      bucket -- signature images are small and this bucket's RLS
--      already does exactly what's needed.
--
--   2. Class Teacher on the Staff form (item 11). Rather than a new
--      schema, this writes into the *existing* teacher_assignments
--      table (supabase/portals_migration.sql) with role='class_teacher'
--      and subject_id=NULL, which the messaging/attendance/assessment
--      modules already understand. staff_members has no direct
--      user_id-to-class link, so this migration only adds a helper RPC
--      (set_class_teacher) that upserts/removes that assignment row
--      via the staff member's linked auth user (staff_members.user_id)
--      -- no new columns.
--
-- SAFE TO RE-RUN.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Signatures storage table
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS letter_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label text NOT NULL,                 -- "Principal", "Bursar", "HR Manager", ...
  signatory_name text,                 -- printed name under the image, e.g. "Mrs. Adeyemi Grace"
  signatory_title text,                -- printed title, e.g. "Principal"
  image_url text NOT NULL,             -- public URL in the profile-photos bucket
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_letter_signatures_org ON letter_signatures(organization_id);

ALTER TABLE letter_signatures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS letter_signatures_tenant_read ON letter_signatures;
CREATE POLICY letter_signatures_tenant_read ON letter_signatures FOR SELECT
  USING (organization_id = current_user_org_id());

DROP POLICY IF EXISTS letter_signatures_admin_write ON letter_signatures;
CREATE POLICY letter_signatures_admin_write ON letter_signatures FOR ALL
  USING (is_org_admin(organization_id))
  WITH CHECK (is_org_admin(organization_id));

-- ---------------------------------------------------------------------
-- 2. Per-letter-type default (which signature, if any, applies)
-- ---------------------------------------------------------------------
-- letter_type is a free-form slug the app controls, e.g.:
--   'payslip', 'report_card', 'admission_letter', 'enrollment_certificate',
--   'welcome_pack', 'expense_voucher'
CREATE TABLE IF NOT EXISTS letter_signature_defaults (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  letter_type text NOT NULL,
  signature_id uuid REFERENCES letter_signatures(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, letter_type)
);

ALTER TABLE letter_signature_defaults ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS letter_sig_defaults_tenant_read ON letter_signature_defaults;
CREATE POLICY letter_sig_defaults_tenant_read ON letter_signature_defaults FOR SELECT
  USING (organization_id = current_user_org_id());

DROP POLICY IF EXISTS letter_sig_defaults_admin_write ON letter_signature_defaults;
CREATE POLICY letter_sig_defaults_admin_write ON letter_signature_defaults FOR ALL
  USING (is_org_admin(organization_id))
  WITH CHECK (is_org_admin(organization_id));

-- ---------------------------------------------------------------------
-- 3. RPC: get the effective signature for a letter type (or null)
-- ---------------------------------------------------------------------
-- Any org member can call this (it's just read access to a print
-- helper) -- the underlying tables' SELECT RLS already scopes it to
-- the caller's own org.
CREATE OR REPLACE FUNCTION get_letter_signature(p_letter_type text)
RETURNS TABLE (
  signature_id uuid,
  label text,
  signatory_name text,
  signatory_title text,
  image_url text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT s.id, s.label, s.signatory_name, s.signatory_title, s.image_url
  FROM letter_signature_defaults d
  JOIN letter_signatures s ON s.id = d.signature_id AND s.active = true
  WHERE d.organization_id = current_user_org_id()
    AND d.letter_type = p_letter_type
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_letter_signature(text) TO authenticated;

-- ---------------------------------------------------------------------
-- 4. RPC: set/clear the default signature for a letter type
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_letter_signature_default(p_letter_type text, p_signature_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
BEGIN
  IF v_org IS NULL OR NOT is_org_admin(v_org) THEN
    RAISE EXCEPTION 'Not authorized.';
  END IF;

  INSERT INTO letter_signature_defaults (organization_id, letter_type, signature_id, updated_at)
  VALUES (v_org, p_letter_type, p_signature_id, now())
  ON CONFLICT (organization_id, letter_type)
  DO UPDATE SET signature_id = EXCLUDED.signature_id, updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION set_letter_signature_default(text, uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 5. Class Teacher helper RPC (item 11)
-- ---------------------------------------------------------------------
-- Sets or clears p_staff_id as the class_teacher for p_class_id in the
-- current org. A class can have at most one class_teacher at a time --
-- assigning a new one automatically deactivates any existing
-- class_teacher row for that class (mirrors how a school actually
-- works: one homeroom/class teacher per class).
CREATE OR REPLACE FUNCTION set_class_teacher(p_staff_id uuid, p_class_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_user_id uuid;
BEGIN
  IF v_org IS NULL OR NOT is_org_admin(v_org) THEN
    RAISE EXCEPTION 'Not authorized.';
  END IF;

  -- Deactivate any existing class_teacher assignment for this class
  -- in this org (whoever it was before), regardless of which staff
  -- member it belonged to.
  UPDATE teacher_assignments ta
  SET active = false
  FROM staff_members sm
  WHERE ta.user_id = sm.user_id
    AND ta.class_id = p_class_id
    AND ta.role = 'class_teacher'
    AND ta.organization_id = v_org;

  IF p_staff_id IS NULL THEN
    RETURN; -- caller only wanted to clear the class teacher
  END IF;

  SELECT user_id INTO v_user_id FROM staff_members
  WHERE id = p_staff_id AND organization_id = v_org;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'This staff member has no linked login account, so they cannot be assigned as class teacher yet.';
  END IF;

  -- Note: teacher_assignments' UNIQUE(user_id, class_id, subject_id)
  -- does NOT collide two NULL subject_id rows for the same
  -- user_id/class_id (standard SQL NULL-distinct semantics), so
  -- ON CONFLICT can't be relied on here -- reactivate an existing
  -- (possibly just-deactivated, or previously deactivated) row for
  -- this exact user+class+NULL-subject combo if one exists, otherwise
  -- insert a fresh one.
  UPDATE teacher_assignments
  SET role = 'class_teacher', active = true
  WHERE user_id = v_user_id
    AND class_id = p_class_id
    AND subject_id IS NULL
    AND organization_id = v_org;

  IF NOT FOUND THEN
    INSERT INTO teacher_assignments (user_id, class_id, subject_id, role, organization_id, active)
    VALUES (v_user_id, p_class_id, NULL, 'class_teacher', v_org, true);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION set_class_teacher(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 6. RPC: list current class-teacher assignments for this org, joined
--    with staff name and class name (for populating the Staff form's
--    "Class Teacher" dropdown state and the class list).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_class_teachers()
RETURNS TABLE (class_id uuid, class_name text, staff_id uuid, staff_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT c.id, c.name, sm.id, sm.full_name
  FROM teacher_assignments ta
  JOIN classes c ON c.id = ta.class_id
  JOIN staff_members sm ON sm.user_id = ta.user_id AND sm.organization_id = ta.organization_id
  WHERE ta.organization_id = current_user_org_id()
    AND ta.role = 'class_teacher'
    AND ta.active = true;
$$;

GRANT EXECUTE ON FUNCTION list_class_teachers() TO authenticated;

-- ---------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------
SELECT
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'letter_signatures') AS letter_signatures_installed,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'letter_signature_defaults') AS letter_signature_defaults_installed,
  (SELECT COUNT(*) FROM pg_proc WHERE proname = 'get_letter_signature') AS get_letter_signature_installed,
  (SELECT COUNT(*) FROM pg_proc WHERE proname = 'set_letter_signature_default') AS set_letter_signature_default_installed,
  (SELECT COUNT(*) FROM pg_proc WHERE proname = 'set_class_teacher') AS set_class_teacher_installed,
  (SELECT COUNT(*) FROM pg_proc WHERE proname = 'list_class_teachers') AS list_class_teachers_installed;
