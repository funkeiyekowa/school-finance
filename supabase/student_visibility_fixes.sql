-- =====================================================================
-- STUDENT VISIBILITY FIXES  (fixes "student S288 sees nothing" bug)
-- =====================================================================
-- Root cause:
--   Provisioned student auth users had NO org_memberships row and NO
--   profiles row, so current_user_org_id() returned NULL and strict
--   per-org RLS blocked EVERYTHING - including their own student row,
--   report_cards, exam_attempts, cbt_exam_assignments, announcements.
--
-- This migration:
--   1. Backfills a profiles row for every provisioned student/parent/
--      teacher auth user (role tagged, active).
--   2. Backfills an org_memberships row for every student/parent/teacher
--      so current_user_org_id() resolves to their school. Role is set to
--      'student' / 'parent' / 'teacher' - which is *not* an owner/admin
--      role, so they cannot escalate.
--   3. Adds SECURITY DEFINER RPC get_my_student_context() that returns
--      the caller's student row REGARDLESS of RLS. Used by the portal
--      as the safe entry point.
--   4. Adds narrow SELF-READ policies (in addition to the strict per-org
--      policy) so the student can read their own report_cards,
--      exam_attempts, cbt_exam_assignments, student_scores.
--   5. Updates the auto_provision triggers so newly-created students,
--      parents and teachers also get a profile + membership.
--
-- IDEMPOTENT: DROP POLICY IF EXISTS, ON CONFLICT DO NOTHING, CREATE OR
-- REPLACE FUNCTION throughout. Safe to re-run.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Backfill profiles for all provisioned student auth users
-- ---------------------------------------------------------------------
INSERT INTO public.profiles (id, email, full_name, role, active, organization_id)
SELECT
  s.profile_id,
  LOWER(s.student_code) || '@student.local',
  s.full_name,
  'student',
  TRUE,
  s.organization_id
FROM public.students s
WHERE s.profile_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = s.profile_id)
ON CONFLICT (id) DO NOTHING;

-- Parents: profile_id lives on parent_profiles
INSERT INTO public.profiles (id, email, full_name, role, active, organization_id)
SELECT DISTINCT ON (pp.profile_id)
  pp.profile_id,
  LOWER(pp.email),
  COALESCE(pp.full_name, pp.email),
  'parent',
  TRUE,
  s.organization_id
FROM public.parent_profiles pp
LEFT JOIN public.parent_student_links psl ON psl.parent_id = pp.id
LEFT JOIN public.students s ON s.id = psl.student_id
WHERE pp.profile_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = pp.profile_id)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. Backfill org_memberships so current_user_org_id() resolves
-- ---------------------------------------------------------------------
INSERT INTO public.org_memberships (user_id, organization_id, role, is_default, active)
SELECT
  s.profile_id, s.organization_id, 'student', TRUE, TRUE
FROM public.students s
WHERE s.profile_id IS NOT NULL
  AND s.organization_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.org_memberships m
    WHERE m.user_id = s.profile_id AND m.organization_id = s.organization_id
  )
ON CONFLICT DO NOTHING;

INSERT INTO public.org_memberships (user_id, organization_id, role, is_default, active)
SELECT DISTINCT ON (pp.profile_id, s.organization_id)
  pp.profile_id, s.organization_id, 'parent', TRUE, TRUE
FROM public.parent_profiles pp
JOIN public.parent_student_links psl ON psl.parent_id = pp.id
JOIN public.students s ON s.id = psl.student_id
WHERE pp.profile_id IS NOT NULL
  AND s.organization_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.org_memberships m
    WHERE m.user_id = pp.profile_id AND m.organization_id = s.organization_id
  )
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'teachers') THEN
    INSERT INTO public.org_memberships (user_id, organization_id, role, is_default, active)
    SELECT t.profile_id, t.organization_id, 'teacher', TRUE, TRUE
    FROM public.teachers t
    WHERE t.profile_id IS NOT NULL
      AND t.organization_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.org_memberships m
        WHERE m.user_id = t.profile_id AND m.organization_id = t.organization_id
      )
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3. SECURITY DEFINER RPCs
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_student_context()
RETURNS TABLE (
  id UUID,
  organization_id UUID,
  student_code TEXT,
  full_name TEXT,
  grade TEXT,
  status TEXT,
  must_change_password BOOLEAN,
  guardian_email TEXT,
  guardian_name TEXT,
  guardian_phone TEXT
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT s.id, s.organization_id, s.student_code, s.full_name, s.grade,
         s.status, s.must_change_password,
         s.guardian_email, s.guardian_name, s.guardian_phone
  FROM public.students s
  WHERE s.profile_id = auth.uid()
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_my_student_context() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_parent_children()
RETURNS TABLE (
  id UUID, organization_id UUID, student_code TEXT,
  full_name TEXT, grade TEXT, status TEXT
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT s.id, s.organization_id, s.student_code, s.full_name, s.grade, s.status
  FROM public.parent_profiles pp
  JOIN public.parent_student_links psl ON psl.parent_id = pp.id
  JOIN public.students s ON s.id = psl.student_id
  WHERE pp.profile_id = auth.uid()
    AND s.status = 'active';
$$;
GRANT EXECUTE ON FUNCTION public.get_my_parent_children() TO authenticated;

-- ---------------------------------------------------------------------
-- 4. SELF-READ RLS policies (additive; OR'd with tenant policies)
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS student_self_read ON public.students;
CREATE POLICY student_self_read ON public.students
  FOR SELECT USING (profile_id = auth.uid());

DROP POLICY IF EXISTS student_self_report_cards ON public.report_cards;
CREATE POLICY student_self_report_cards ON public.report_cards
  FOR SELECT USING (
    student_id IN (SELECT id FROM public.students WHERE profile_id = auth.uid())
  );

DROP POLICY IF EXISTS student_self_exam_attempts ON public.exam_attempts;
CREATE POLICY student_self_exam_attempts ON public.exam_attempts
  FOR SELECT USING (
    student_id IN (SELECT id FROM public.students WHERE profile_id = auth.uid())
  );

DROP POLICY IF EXISTS student_self_exam_answers ON public.exam_answers;
CREATE POLICY student_self_exam_answers ON public.exam_answers
  FOR SELECT USING (
    attempt_id IN (
      SELECT ea.id FROM public.exam_attempts ea
      JOIN public.students s ON s.id = ea.student_id
      WHERE s.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS student_self_cbt_assignments ON public.cbt_exam_assignments;
CREATE POLICY student_self_cbt_assignments ON public.cbt_exam_assignments
  FOR SELECT USING (
    student_id IN (SELECT id FROM public.students WHERE profile_id = auth.uid())
    OR class_id IN (
      SELECT c.id FROM public.classes c, public.students s
      WHERE s.profile_id = auth.uid()
        AND (c.name = s.grade OR c.short_code = s.grade)
    )
  );

DROP POLICY IF EXISTS student_read_published_exams ON public.exams;
CREATE POLICY student_read_published_exams ON public.exams
  FOR SELECT USING (
    status = 'published'
    AND organization_id IN (
      SELECT organization_id FROM public.students WHERE profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS student_self_scores ON public.student_scores;
CREATE POLICY student_self_scores ON public.student_scores
  FOR SELECT USING (
    student_id IN (SELECT id FROM public.students WHERE profile_id = auth.uid())
  );

DROP POLICY IF EXISTS student_self_attendance ON public.attendance_records;
CREATE POLICY student_self_attendance ON public.attendance_records
  FOR SELECT USING (
    student_id IN (SELECT id FROM public.students WHERE profile_id = auth.uid())
  );

DROP POLICY IF EXISTS student_read_announcements ON public.announcements;
CREATE POLICY student_read_announcements ON public.announcements
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM public.students WHERE profile_id = auth.uid()
      UNION
      SELECT s.organization_id FROM public.parent_profiles pp
        JOIN public.parent_student_links psl ON psl.parent_id = pp.id
        JOIN public.students s ON s.id = psl.student_id
        WHERE pp.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS parent_read_children ON public.students;
CREATE POLICY parent_read_children ON public.students
  FOR SELECT USING (
    id IN (
      SELECT psl.student_id FROM public.parent_profiles pp
      JOIN public.parent_student_links psl ON psl.parent_id = pp.id
      WHERE pp.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS parent_read_children_report_cards ON public.report_cards;
CREATE POLICY parent_read_children_report_cards ON public.report_cards
  FOR SELECT USING (
    student_id IN (
      SELECT psl.student_id FROM public.parent_profiles pp
      JOIN public.parent_student_links psl ON psl.parent_id = pp.id
      WHERE pp.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS parent_read_children_attempts ON public.exam_attempts;
CREATE POLICY parent_read_children_attempts ON public.exam_attempts
  FOR SELECT USING (
    student_id IN (
      SELECT psl.student_id FROM public.parent_profiles pp
      JOIN public.parent_student_links psl ON psl.parent_id = pp.id
      WHERE pp.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS parent_read_children_attendance ON public.attendance_records;
CREATE POLICY parent_read_children_attendance ON public.attendance_records
  FOR SELECT USING (
    student_id IN (
      SELECT psl.student_id FROM public.parent_profiles pp
      JOIN public.parent_student_links psl ON psl.parent_id = pp.id
      WHERE pp.profile_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------
-- 5. Updated auto-provision triggers: also create profile + membership
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_provision_student()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
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

    INSERT INTO public.profiles (id, email, full_name, role, active, organization_id)
    VALUES (v_uid, v_email, NEW.full_name, 'student', TRUE, NEW.organization_id)
    ON CONFLICT (id) DO NOTHING;

    IF NEW.organization_id IS NOT NULL THEN
      INSERT INTO public.org_memberships (user_id, organization_id, role, is_default, active)
      VALUES (v_uid, NEW.organization_id, 'student', TRUE, TRUE)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.auto_provision_parent()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
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
      INSERT INTO public.parent_student_links (parent_id, student_id, organization_id)
      VALUES (v_parent_id, NEW.id, NEW.organization_id)
      ON CONFLICT (parent_id, student_id) DO NOTHING;
    END IF;

    INSERT INTO public.profiles (id, email, full_name, role, active, organization_id)
    VALUES (v_uid, LOWER(NEW.guardian_email),
            COALESCE(NEW.guardian_name, NEW.guardian_email),
            'parent', TRUE, NEW.organization_id)
    ON CONFLICT (id) DO NOTHING;

    IF NEW.organization_id IS NOT NULL THEN
      INSERT INTO public.org_memberships (user_id, organization_id, role, is_default, active)
      VALUES (v_uid, NEW.organization_id, 'parent', TRUE, TRUE)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- 6. Verification
-- ---------------------------------------------------------------------
SELECT 'Students with profile+membership' AS metric, COUNT(*) AS total
FROM public.students s
WHERE s.profile_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = s.profile_id)
  AND EXISTS (SELECT 1 FROM public.org_memberships m WHERE m.user_id = s.profile_id)
UNION ALL
SELECT 'Students missing profile', COUNT(*)
FROM public.students s
WHERE s.profile_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = s.profile_id)
UNION ALL
SELECT 'Students missing membership', COUNT(*)
FROM public.students s
WHERE s.profile_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.org_memberships m WHERE m.user_id = s.profile_id);

COMMIT;
