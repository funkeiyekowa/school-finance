-- =====================================================================
-- ADMISSIONS MODULE — application pipeline from enquiry to enrolled
-- =====================================================================
-- Run order: after saas_foundation.sql (#22 — is_org_admin),
-- multi_tenant_migration.sql (current_user_org_id),
-- rls_role_scoped_access.sql (is_staff_user), website_module.sql
-- (website_submissions, which an application can be raised from) and
-- 20260905120000_phase1_security_enforcement.sql (the students write
-- guard — see admit_application below).
--
-- Creates ONE new table and adds policies only to that new table, so it
-- touches nothing existing and can be run last at any time.
-- Idempotent. Manual apply in the Supabase SQL editor.
--
-- WHY: website_submissions already captures admission *enquiries* and the
-- students table holds those already enrolled, but nothing tracked the
-- middle — reviewing an applicant, making an offer, and turning an
-- accepted offer into a student record. Admissions staff were doing that
-- in their heads or in a spreadsheet.
--
--   new -> reviewing -> offered -> accepted -> enrolled
--                    \-> rejected      \-> withdrawn
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admission_applications (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  reference       text,

  -- Applicant
  applicant_name  text        NOT NULL,
  date_of_birth   date,
  gender          text,
  -- Free text to match students.grade, which is also text.
  applying_for    text,
  address         text,

  -- Guardian
  guardian_name   text,
  guardian_phone  text,
  guardian_email  text,

  -- Provenance. When an application is raised from a website enquiry we
  -- keep the link so the lead and the application stay connected.
  source          text        NOT NULL DEFAULT 'manual',
  submission_id   uuid        REFERENCES public.website_submissions(id) ON DELETE SET NULL,

  status          text        NOT NULL DEFAULT 'new',
  notes           text,
  decision_notes  text,
  decided_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at      timestamptz,

  -- Set once the application becomes a real student record.
  student_id      uuid        REFERENCES public.students(id) ON DELETE SET NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT admission_applications_status_chk CHECK (
    status IN ('new','reviewing','offered','accepted','enrolled','rejected','withdrawn')
  ),
  CONSTRAINT admission_applications_source_chk CHECK (
    source IN ('manual','website','referral','walk_in')
  ),
  CONSTRAINT admission_applications_reference_org_uq UNIQUE (organization_id, reference)
);

CREATE INDEX IF NOT EXISTS admission_applications_org_status_idx
  ON public.admission_applications (organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS admission_applications_submission_idx
  ON public.admission_applications (submission_id);


-- ---------------------------------------------------------------------
-- 2. Reference numbering (ADM-0001), per org, atomic. Same advisory-lock
--    pattern as prepare_income_receipt_number().
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prepare_admission_reference()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_org  uuid;
  v_next bigint;
BEGIN
  v_org := COALESCE(NEW.organization_id, public.current_user_org_id());
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'No organization in scope for this application'
      USING ERRCODE = '42501';
  END IF;
  NEW.organization_id := v_org;

  IF NEW.reference IS NULL OR btrim(NEW.reference) = '' THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended('admission:ref:' || v_org::text, 0)
    );
    SELECT COALESCE(MAX(substring(reference FROM '^ADM-([0-9]+)$')::bigint), 0) + 1
      INTO v_next
      FROM public.admission_applications
     WHERE organization_id = v_org
       AND reference ~ '^ADM-[0-9]+$';
    NEW.reference := 'ADM-' || lpad(v_next::text, 4, '0');
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_admission_reference ON public.admission_applications;
CREATE TRIGGER trg_admission_reference
  BEFORE INSERT ON public.admission_applications
  FOR EACH ROW EXECUTE FUNCTION public.prepare_admission_reference();


CREATE OR REPLACE FUNCTION public.touch_admission_application()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.status IN ('offered','accepted','rejected','withdrawn','enrolled')
     AND NEW.status IS DISTINCT FROM COALESCE(OLD.status, '') THEN
    NEW.decided_at := COALESCE(NEW.decided_at, now());
    NEW.decided_by := COALESCE(NEW.decided_by, auth.uid());
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_admission_touch ON public.admission_applications;
CREATE TRIGGER trg_admission_touch
  BEFORE UPDATE ON public.admission_applications
  FOR EACH ROW EXECUTE FUNCTION public.touch_admission_application();


-- ---------------------------------------------------------------------
-- 3. RLS — staff-only. An applicant is not a user of this system yet, so
--    there is deliberately no self-service read path.
--    Policies are dropped by name and recreated so a re-run cannot
--    accumulate widening policies (CLAUDE.md §5).
-- ---------------------------------------------------------------------
ALTER TABLE public.admission_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admission_applications_select ON public.admission_applications;
DROP POLICY IF EXISTS admission_applications_insert ON public.admission_applications;
DROP POLICY IF EXISTS admission_applications_update ON public.admission_applications;
DROP POLICY IF EXISTS admission_applications_delete ON public.admission_applications;

CREATE POLICY admission_applications_select ON public.admission_applications
  FOR SELECT USING (
    organization_id = public.current_user_org_id() AND public.is_staff_user()
  );

CREATE POLICY admission_applications_insert ON public.admission_applications
  FOR INSERT WITH CHECK (
    organization_id = public.current_user_org_id() AND public.is_staff_user()
  );

CREATE POLICY admission_applications_update ON public.admission_applications
  FOR UPDATE USING (
    organization_id = public.current_user_org_id() AND public.is_staff_user()
  )
  WITH CHECK (
    organization_id = public.current_user_org_id() AND public.is_staff_user()
  );

-- Only an admin may erase an application outright; staff move it to
-- 'withdrawn' instead, which keeps the audit trail.
CREATE POLICY admission_applications_delete ON public.admission_applications
  FOR DELETE USING (
    organization_id = public.current_user_org_id()
    AND public.is_org_admin(organization_id)
  );


-- ---------------------------------------------------------------------
-- 4. admit_application — turn an accepted application into a student.
--
--    Deliberately NOT run under any guard exemption. students carries
--    phase1_sensitive_write_guard, which requires phase1_hr_access() —
--    owner/admin/editor/staff/bursar/accountant/developer. Admissions
--    staff already hold one of those roles, so the insert succeeds on
--    its own merit and the guard keeps doing its job. If a caller
--    without HR access tries, the guard correctly refuses.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admit_application(
  p_application_id uuid,
  p_student_code   text DEFAULT NULL,
  p_academic_year  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_app   record;
  v_org   uuid;
  v_code  text;
  v_next  bigint;
  v_id    uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not signed in';
  END IF;

  SELECT * INTO v_app
    FROM public.admission_applications
   WHERE id = p_application_id;

  IF v_app.id IS NULL THEN
    RAISE EXCEPTION 'Application not found';
  END IF;
  v_org := v_app.organization_id;

  -- Authorize against the application's own org, not "any org".
  IF NOT public.is_org_admin(v_org) AND NOT (
    v_org = public.current_user_org_id() AND public.is_staff_user()
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF v_app.student_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true, 'student_id', v_app.student_id, 'already_admitted', true
    );
  END IF;

  IF v_app.status <> 'accepted' THEN
    RAISE EXCEPTION 'Only an accepted application can be admitted (this one is %)', v_app.status;
  END IF;

  -- Allocate a student_code if the caller did not supply one. Same
  -- advisory-lock approach as the other per-org numbering.
  v_code := NULLIF(btrim(COALESCE(p_student_code, '')), '');
  IF v_code IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('student:code:' || v_org::text, 0));
    SELECT COALESCE(MAX(substring(student_code FROM '^STU-([0-9]+)$')::bigint), 0) + 1
      INTO v_next
      FROM public.students
     WHERE organization_id = v_org
       AND student_code ~ '^STU-[0-9]+$';
    v_code := 'STU-' || lpad(v_next::text, 4, '0');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.students
     WHERE organization_id = v_org AND student_code = v_code
  ) THEN
    RAISE EXCEPTION 'Student code % is already in use', v_code;
  END IF;

  INSERT INTO public.students (
    student_code, full_name, grade, academic_year, gender, date_of_birth,
    admission_date, address, guardian_name, guardian_phone, guardian_email,
    status, organization_id, notes
  ) VALUES (
    v_code, v_app.applicant_name, v_app.applying_for, p_academic_year,
    v_app.gender, v_app.date_of_birth, CURRENT_DATE, v_app.address,
    v_app.guardian_name, v_app.guardian_phone, v_app.guardian_email,
    'active', v_org,
    NULLIF(concat_ws(E'\n', v_app.notes, 'Admitted from ' || COALESCE(v_app.reference, 'application')), '')
  )
  RETURNING id INTO v_id;

  UPDATE public.admission_applications
     SET student_id = v_id,
         status     = 'enrolled',
         decided_by = COALESCE(decided_by, auth.uid()),
         decided_at = COALESCE(decided_at, now())
   WHERE id = p_application_id;

  -- Close the originating enquiry, if there was one.
  IF v_app.submission_id IS NOT NULL THEN
    UPDATE public.website_submissions
       SET status = 'converted'
     WHERE id = v_app.submission_id
       AND organization_id = v_org;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'student_id', v_id, 'student_code', v_code
  );
END $$;

REVOKE ALL ON FUNCTION public.admit_application(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admit_application(uuid, text, text) TO authenticated;


-- =====================================================================
-- VERIFICATION (read-only) — run after applying.
-- =====================================================================

-- V1. Table exists with RLS enabled.
SELECT 'V1 table' AS check, c.relname, c.relrowsecurity AS rls_enabled
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'admission_applications';

-- V2. Exactly four policies, one per command (expect 4 rows).
SELECT 'V2 policies' AS check, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'admission_applications'
ORDER BY cmd;

-- V3. anon can neither read the table nor execute the RPC (expect 0 rows).
SELECT 'V3 anon table' AS check, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'admission_applications' AND grantee = 'anon'
UNION ALL
SELECT 'V3 anon rpc', 'EXECUTE'
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'admit_application'
  AND has_function_privilege('anon', p.oid, 'EXECUTE');

-- V4. The students write guard is untouched — admit_application relies on
--     phase1_hr_access() still gating it. Expect true.
SELECT 'V4 guard untouched' AS check,
       pg_get_functiondef(oid) LIKE '%student administration authorization required%' AS still_guards_students
FROM pg_proc WHERE proname = 'phase1_sensitive_write_guard';
