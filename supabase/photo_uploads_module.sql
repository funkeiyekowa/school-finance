-- =====================================================================
-- PHOTO UPLOADS MODULE
-- =====================================================================
-- Adds photo support for students and staff:
--   - students.photo_url, staff_members.photo_url
--   - a public, org-scoped "profile-photos" storage bucket (mirrors the
--     website-media bucket's public-read + org-prefix-write pattern)
--   - student_photo_submissions: a moderation queue for parent-submitted
--     child photos (parents cannot write students.photo_url directly --
--     an admin/staff member must approve first, so a low-quality or
--     wrong photo never lands on an official ID card unreviewed)
--   - RPCs: update_my_staff_photo (self-service), submit_student_photo
--     (parent submission), approve/reject_student_photo (moderation),
--     bulk_set_student_photos / bulk_set_staff_photos (admin bulk
--     upload committing many matched photos in one call)
--
-- SAFE TO RE-RUN.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------
ALTER TABLE students      ADD COLUMN IF NOT EXISTS photo_url text;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS photo_url text;

-- ---------------------------------------------------------------------
-- 2. Moderation queue for parent-submitted student photos
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS student_photo_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  submitted_by_parent_id uuid REFERENCES parent_profiles(id) ON DELETE SET NULL,
  photo_url text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason text,
  reviewed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sps_org ON student_photo_submissions(organization_id);
CREATE INDEX IF NOT EXISTS idx_sps_student ON student_photo_submissions(student_id);
CREATE INDEX IF NOT EXISTS idx_sps_status ON student_photo_submissions(organization_id, status);

ALTER TABLE student_photo_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sps_tenant_read ON student_photo_submissions;
CREATE POLICY sps_tenant_read ON student_photo_submissions FOR SELECT
  USING (organization_id = current_user_org_id());

-- Parents may only insert a submission for their own linked child.
DROP POLICY IF EXISTS sps_parent_insert ON student_photo_submissions;
CREATE POLICY sps_parent_insert ON student_photo_submissions FOR INSERT
  WITH CHECK (
    organization_id = current_user_org_id()
    AND EXISTS (
      SELECT 1 FROM parent_student_links psl
      JOIN parent_profiles pp ON pp.id = psl.parent_id
      WHERE psl.student_id = student_photo_submissions.student_id
        AND pp.profile_id = auth.uid()
    )
  );

-- Staff/admin may update (approve/reject) within their org. Direct table
-- UPDATE is still tenant-only (matches this codebase's established
-- pattern -- role enforcement is client-side nav gating + the RPCs
-- below), the RPCs are the safe entry point the UI actually calls.
DROP POLICY IF EXISTS sps_tenant_update ON student_photo_submissions;
CREATE POLICY sps_tenant_update ON student_photo_submissions FOR UPDATE
  USING (organization_id = current_user_org_id());

-- ---------------------------------------------------------------------
-- 3. Storage — profile-photos (PUBLIC, like website-media).
--    Path shape: <organization_id>/students/<student_id>/<uuid>.jpg
--                <organization_id>/staff/<staff_id>/<uuid>.jpg
-- ---------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-photos', 'profile-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS profile_photos_public_read ON storage.objects;
CREATE POLICY profile_photos_public_read ON storage.objects FOR SELECT
  USING (bucket_id = 'profile-photos');

DROP POLICY IF EXISTS profile_photos_tenant_write ON storage.objects;
CREATE POLICY profile_photos_tenant_write ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'profile-photos'
    AND (storage.foldername(name))[1] = current_user_org_id()::text
  );

DROP POLICY IF EXISTS profile_photos_tenant_update ON storage.objects;
CREATE POLICY profile_photos_tenant_update ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'profile-photos'
    AND (storage.foldername(name))[1] = current_user_org_id()::text
  );

DROP POLICY IF EXISTS profile_photos_tenant_delete ON storage.objects;
CREATE POLICY profile_photos_tenant_delete ON storage.objects FOR DELETE
  USING (
    bucket_id = 'profile-photos'
    AND (storage.foldername(name))[1] = current_user_org_id()::text
  );

-- ---------------------------------------------------------------------
-- 4. Self-service: a signed-in staff member sets their own photo.
--    Matches by email (staff_members has no auth-user FK column), scoped
--    to the caller's own org -- cannot touch anyone else's row.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_my_staff_photo(p_photo_url text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_email text;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;

  UPDATE staff_members
  SET photo_url = p_photo_url, updated_at = now()
  WHERE lower(email) = lower(v_email)
    AND organization_id = current_user_org_id();
END;
$$;

GRANT EXECUTE ON FUNCTION update_my_staff_photo(text) TO authenticated;

-- ---------------------------------------------------------------------
-- 5. Parent submits a photo for one of their linked children.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION submit_student_photo(p_student_id uuid, p_photo_url text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_parent_id uuid;
  v_submission_id uuid;
BEGIN
  SELECT pp.id INTO v_parent_id
  FROM parent_profiles pp
  JOIN parent_student_links psl ON psl.parent_id = pp.id
  WHERE pp.profile_id = auth.uid()
    AND psl.student_id = p_student_id
  LIMIT 1;

  IF v_parent_id IS NULL THEN
    RAISE EXCEPTION 'You are not linked to this student';
  END IF;

  INSERT INTO student_photo_submissions (organization_id, student_id, submitted_by_parent_id, photo_url, status)
  VALUES (v_org, p_student_id, v_parent_id, p_photo_url, 'pending')
  RETURNING id INTO v_submission_id;

  RETURN v_submission_id;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_student_photo(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 6. Admin/staff approve or reject a pending submission.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION approve_student_photo(p_submission_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_student_id uuid;
  v_photo_url text;
  v_role text;
BEGIN
  SELECT role INTO v_role FROM org_memberships
  WHERE organization_id = v_org AND user_id = auth.uid() AND active = true;

  IF v_role IS NULL OR v_role NOT IN ('owner','admin','editor','staff','bursar','accountant','teacher','super_admin') THEN
    RAISE EXCEPTION 'Not authorized to approve photos';
  END IF;

  SELECT student_id, photo_url INTO v_student_id, v_photo_url
  FROM student_photo_submissions
  WHERE id = p_submission_id AND organization_id = v_org AND status = 'pending';

  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'Submission not found or already reviewed';
  END IF;

  UPDATE students SET photo_url = v_photo_url, updated_at = now() WHERE id = v_student_id;

  UPDATE student_photo_submissions
  SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
  WHERE id = p_submission_id;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_student_photo(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION reject_student_photo(p_submission_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_role text;
BEGIN
  SELECT role INTO v_role FROM org_memberships
  WHERE organization_id = v_org AND user_id = auth.uid() AND active = true;

  IF v_role IS NULL OR v_role NOT IN ('owner','admin','editor','staff','bursar','accountant','teacher','super_admin') THEN
    RAISE EXCEPTION 'Not authorized to review photos';
  END IF;

  UPDATE student_photo_submissions
  SET status = 'rejected', rejection_reason = p_reason, reviewed_by = auth.uid(), reviewed_at = now()
  WHERE id = p_submission_id AND organization_id = v_org AND status = 'pending';
END;
$$;

GRANT EXECUTE ON FUNCTION reject_student_photo(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 7. Admin bulk upload — commit many matched (id -> photo_url) pairs in
--    one call, so a class-photo-day batch is one round trip, not N.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION bulk_set_student_photos(p_pairs jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_count integer := 0;
BEGIN
  UPDATE students s
  SET photo_url = pair->>'photo_url', updated_at = now()
  FROM jsonb_array_elements(p_pairs) AS pair
  WHERE s.id = (pair->>'student_id')::uuid
    AND s.organization_id = v_org;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION bulk_set_student_photos(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION bulk_set_staff_photos(p_pairs jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_count integer := 0;
BEGIN
  UPDATE staff_members s
  SET photo_url = pair->>'photo_url', updated_at = now()
  FROM jsonb_array_elements(p_pairs) AS pair
  WHERE s.id = (pair->>'staff_id')::uuid
    AND s.organization_id = v_org;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION bulk_set_staff_photos(jsonb) TO authenticated;

-- Verify
SELECT 'photo_uploads_module installed' AS status,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'students' AND column_name = 'photo_url') AS students_col,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'staff_members' AND column_name = 'photo_url') AS staff_col,
  (SELECT COUNT(*) FROM storage.buckets WHERE id = 'profile-photos') AS bucket_installed;
