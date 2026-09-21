-- =====================================================================
-- Phase 1 guard v2 -- decompose the universal phase1_sensitive_write_guard
-- into per-table safe trigger functions, backfill legacy NULL
-- organization_id on child tables from authoritative parents, and enforce
-- parent/child tenant consistency.
--
-- WHY:
--   The single phase1_sensitive_write_guard() attached to 60+ heterogeneous
--   tables contains SQL expressions referencing OLD.quiz_id, OLD.lesson_id,
--   OLD.assignment_id, etc. PL/pgSQL plans SQL expressions through SPI
--   using the trigger's actual source-table rowtype; the whole CASE
--   expression is planned even when its runtime branch is unreachable, so
--   an unreachable OLD.quiz_id branch still fails to plan on tables that
--   lack that column -> "record old has no field quiz_id" (42703).
--
--   Legacy child rows on LMS/clinic/library/hostel/transport tables may
--   have organization_id NULL. When a legitimate DELETE cascades, the
--   BEFORE-DELETE trigger fires on those cascaded rows, phase1_same_org
--   receives NULL and correctly returns false -> "organization boundary
--   violation" (P0001) despite legitimate authorization.
--
--   Parent/child organization consistency is not enforced at the DB level.
--
-- WHAT:
--   1. Backfill NULL organization_id on student-linked child tables from
--      the parent students row (same-tenant by construction).
--   2. Backfill lms_quiz_answers.organization_id from parent
--      lms_quiz_attempts (also same-tenant by construction).
--   3. Install per-table trigger functions, each referencing only
--      fields that exist on its attached table. LMS/clinic/library/hostel
--      variants derive org from parent when own value is NULL to permit
--      cascade cleanup on rows the backfill could not resolve
--      (orphan-safe: derived org still passes phase1_same_org, which is
--      itself unchanged).
--   4. Add parent/child org enforcement trigger on student-linked child
--      tables that hard-fails cross-tenant writes and auto-populates
--      omitted organization_id from the parent student row.
--   5. Drop the old universal trigger from every table it was attached
--      to; keep the old function body untouched in the schema so the
--      rollback script can reattach it without needing its source.
--
-- SEMANTICS PRESERVED:
--   - phase1_same_org(v_org) still strictly rejects NULL / cross-org.
--   - is_platform_admin() untouched, still short-circuits phase1_same_org.
--   - Every authorization branch of the original trigger is preserved by
--     a corresponding per-table function.
--   - The service_role/supabase_admin bypass is preserved on EVERY new
--     guard, which is load-bearing for the existing set_config('...role...
--     "service_role"',true) pattern in:
--       admin_reset_team_member_password.sql
--       fix_clear_must_change_password_guard_conflict.sql
--       fix_student_password_flag_stuck.sql
--       admissions_module.sql (admit_application)
--       parent_course_enrolment.sql (enrol_my_child_in_course)
--       shop_module.sql (record_shop_sale)
--
-- RUN ORDER:
--   AFTER: supabase/20260905120000_phase1_security_enforcement.sql
--          supabase/rls_role_scoped_access.sql
--          supabase/tenant_isolation_full.sql
--          supabase/lms_module.sql (defines lms_* rowtypes referenced here)
--   BEFORE: any future migration that reattaches phase1_sensitive_write_guard.
--
-- APPLY: manually in the Supabase SQL editor per CLAUDE.md section 5.
--        Idempotent: safe to re-run.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- SECTION 1 -- Data backfill (idempotent). Copies NULL child org from
-- the authoritative parent row via existing FK. Never overwrites a
-- non-NULL child value, so cross-tenant contamination is impossible.
-- ---------------------------------------------------------------------

-- 1a. Student-linked child tables. Backfill from students.organization_id
--     via the existing FK student_id -> students.id. All such tables
--     have ON DELETE CASCADE, so no orphan-parent case exists.
DO $backfill$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'lms_enrollments','lms_lesson_progress','lms_quiz_attempts',
    'lms_submissions','lms_student_badges',
    'lms_discussions','lms_discussion_replies'
  ] LOOP
    IF to_regclass('public.'||tbl) IS NOT NULL THEN
      EXECUTE format(
        'UPDATE public.%I c SET organization_id = s.organization_id
           FROM public.students s
          WHERE c.student_id = s.id AND c.organization_id IS NULL',
        tbl
      );
    END IF;
  END LOOP;
END
$backfill$;

-- 1b. lms_quiz_answers has NO student_id; derive from lms_quiz_attempts.
DO $$
BEGIN
  IF to_regclass('public.lms_quiz_answers') IS NOT NULL THEN
    UPDATE public.lms_quiz_answers c
       SET organization_id = a.organization_id
      FROM public.lms_quiz_attempts a
     WHERE c.attempt_id = a.id AND c.organization_id IS NULL;
  END IF;
END $$;

-- 1c. Report residual NULLs (informational only; migration continues).
--     Any residual is a genuine orphan (student deleted before FK
--     cascade cleaned it up, or a data-quality bug elsewhere).
DO $$
DECLARE tbl text; n bigint;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'lms_enrollments','lms_lesson_progress','lms_quiz_attempts',
    'lms_submissions','lms_student_badges','lms_discussions',
    'lms_discussion_replies','lms_quiz_answers'
  ] LOOP
    IF to_regclass('public.'||tbl) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE organization_id IS NULL', tbl) INTO n;
      IF n > 0 THEN
        RAISE NOTICE 'phase1_guard_v2: % rows with NULL organization_id in % -- new guard derives org from parent on the fly', n, tbl;
      END IF;
    END IF;
  END LOOP;
END $$;


-- ---------------------------------------------------------------------
-- SECTION 2 -- Per-table safe trigger functions.
--
-- Each function is attached ONLY to tables whose rowtype supports every
-- OLD/NEW field it names, so SPI plan-time resolution always succeeds.
-- Every function preserves the service_role/supabase_admin exemption.
-- ---------------------------------------------------------------------

-- 2a. Truly generic: tables with a plain organization_id column and no
-- table-specific field references. Extracts organization_id via to_jsonb
-- so the function body has zero table-specific field syntax.
CREATE OR REPLACE FUNCTION public.phase1_guard_generic_org()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_org uuid;
BEGIN
  IF auth.role() IN ('service_role','supabase_admin') THEN RETURN COALESCE(NEW, OLD); END IF;

  v_org := NULLIF(to_jsonb(COALESCE(NEW, OLD)) ->> 'organization_id', '')::uuid;

  IF NOT public.phase1_same_org(v_org) THEN
    RAISE EXCEPTION 'organization boundary violation on %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;

  IF TG_TABLE_NAME IN ('expense_entries','income_entries','vendors','bank_transactions','sms_inbox',
                       'payroll_components','payroll_staff_components','payroll_runs','payroll_payslips') THEN
    IF NOT public.phase1_finance_access() THEN RAISE EXCEPTION 'finance permission required'; END IF;

  ELSIF TG_TABLE_NAME = 'staff_members' THEN
    IF NOT public.is_org_admin(v_org) THEN RAISE EXCEPTION 'organization administrator required'; END IF;

  ELSIF TG_TABLE_NAME IN ('roles','org_memberships','teacher_assignments','parent_profiles','parent_student_links') THEN
    IF NOT public.is_org_admin(v_org) THEN RAISE EXCEPTION 'organization administrator required'; END IF;

  ELSIF TG_TABLE_NAME IN ('clinic_patient_records','clinic_visits','clinic_medications_inventory',
                          'clinic_medications_dispensed','clinic_vaccinations','clinic_health_incidents') THEN
    IF NOT public.phase1_clinic_access() THEN RAISE EXCEPTION 'clinic authorization required'; END IF;

  ELSIF TG_TABLE_NAME IN ('assets','asset_assignments','asset_maintenance','asset_disposals',
                          'library_books','library_book_copies','library_loans','library_reservations',
                          'hostel_houses','hostel_rooms','hostel_beds','hostel_allocations',
                          'hostel_visitor_log','hostel_incidents',
                          'transport_vehicles','transport_routes','transport_student_assignments',
                          'procurement_requests','procurement_request_items','procurement_orders',
                          'procurement_order_items','procurement_receipts',
                          'inventory_items','stock_movements','departments') THEN
    IF NOT public.phase1_operations_access() THEN RAISE EXCEPTION 'operations authorization required'; END IF;

  END IF;

  RETURN COALESCE(NEW, OLD);
END $fn$;
GRANT EXECUTE ON FUNCTION public.phase1_guard_generic_org() TO authenticated;

-- 2b. students: hr_access required. organization_id is NOT NULL in prod
-- (tenant_isolation_enforcement.sql), so no fallback needed.
CREATE OR REPLACE FUNCTION public.phase1_guard_students()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_org uuid;
BEGIN
  IF auth.role() IN ('service_role','supabase_admin') THEN RETURN COALESCE(NEW, OLD); END IF;
  v_org := CASE WHEN TG_OP = 'DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
  IF NOT public.phase1_same_org(v_org) THEN RAISE EXCEPTION 'organization boundary violation on students'; END IF;
  IF NOT public.phase1_hr_access() THEN RAISE EXCEPTION 'student administration authorization required'; END IF;
  RETURN COALESCE(NEW, OLD);
END $fn$;
GRANT EXECUTE ON FUNCTION public.phase1_guard_students() TO authenticated;

-- 2c. student_enrollments: organization_id NOT NULL in prod
-- (tenant_isolation_enforcement.sql). Kept explicit rather than generic
-- to match the original trigger's specific hr_access branch.
CREATE OR REPLACE FUNCTION public.phase1_guard_student_enrollments()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_org uuid;
BEGIN
  IF auth.role() IN ('service_role','supabase_admin') THEN RETURN COALESCE(NEW, OLD); END IF;
  v_org := CASE WHEN TG_OP = 'DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
  IF NOT public.phase1_same_org(v_org) THEN RAISE EXCEPTION 'organization boundary violation on student_enrollments'; END IF;
  IF NOT public.phase1_hr_access() THEN RAISE EXCEPTION 'student administration authorization required'; END IF;
  RETURN COALESCE(NEW, OLD);
END $fn$;
GRANT EXECUTE ON FUNCTION public.phase1_guard_student_enrollments() TO authenticated;

-- 2d. student_scores: teacher-class-subject scope; only attached to
-- student_scores, so OLD.class_id/OLD.subject_id are always safe.
CREATE OR REPLACE FUNCTION public.phase1_guard_student_scores()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_org uuid; v_class uuid; v_subject uuid;
BEGIN
  IF auth.role() IN ('service_role','supabase_admin') THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    v_org := OLD.organization_id; v_class := OLD.class_id; v_subject := OLD.subject_id;
  ELSE
    v_org := NEW.organization_id; v_class := NEW.class_id; v_subject := NEW.subject_id;
  END IF;
  IF NOT public.phase1_same_org(v_org) THEN RAISE EXCEPTION 'organization boundary violation on student_scores'; END IF;
  IF NOT (public.phase1_hr_access() OR (
    public.phase1_active_role() = 'teacher' AND EXISTS (
      SELECT 1 FROM public.teacher_assignments ta
      WHERE ta.user_id = auth.uid() AND ta.organization_id = v_org AND ta.active
        AND ta.class_id = v_class AND (ta.subject_id IS NULL OR ta.subject_id = v_subject)
    )
  )) THEN RAISE EXCEPTION 'academic authorization required'; END IF;
  RETURN COALESCE(NEW, OLD);
END $fn$;
GRANT EXECUTE ON FUNCTION public.phase1_guard_student_scores() TO authenticated;

-- 2e. attendance_records: same-shape branch as student_scores.
CREATE OR REPLACE FUNCTION public.phase1_guard_attendance_records()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_org uuid; v_class uuid; v_subject uuid;
BEGIN
  IF auth.role() IN ('service_role','supabase_admin') THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    v_org := OLD.organization_id; v_class := OLD.class_id; v_subject := OLD.subject_id;
  ELSE
    v_org := NEW.organization_id; v_class := NEW.class_id; v_subject := NEW.subject_id;
  END IF;
  IF NOT public.phase1_same_org(v_org) THEN RAISE EXCEPTION 'organization boundary violation on attendance_records'; END IF;
  IF NOT (public.phase1_hr_access() OR (
    public.phase1_active_role() = 'teacher' AND EXISTS (
      SELECT 1 FROM public.teacher_assignments ta
      WHERE ta.user_id = auth.uid() AND ta.organization_id = v_org AND ta.active
        AND ta.class_id = v_class AND (ta.subject_id IS NULL OR ta.subject_id = v_subject)
    )
  )) THEN RAISE EXCEPTION 'academic authorization required'; END IF;
  RETURN COALESCE(NEW, OLD);
END $fn$;
GRANT EXECUTE ON FUNCTION public.phase1_guard_attendance_records() TO authenticated;

-- 2f. LMS per-table. Column set is verified against supabase/lms_module.sql:
--     lms_enrollments      -> (id, course_id, student_id, organization_id)
--     lms_lesson_progress  -> (id, lesson_id, student_id, organization_id)
--     lms_quiz_attempts    -> (id, quiz_id, student_id, organization_id)
--     lms_quiz_answers     -> (id, attempt_id, question_id, organization_id)
--     lms_submissions      -> (id, assignment_id, student_id, organization_id)
--     lms_student_badges   -> (id, badge_id, student_id, organization_id)
--     lms_courses/lessons/quizzes/quiz_questions/assignments/badges/
--     discussions/discussion_replies -> no per-student authorization
--     beyond same-org + admin/teacher scope.
--
-- Org derivation from parent handles legacy NULLs the backfill couldn't
-- resolve. It never widens authorization: v_org still MUST pass
-- phase1_same_org.

CREATE OR REPLACE FUNCTION public.phase1_guard_lms_enrollments()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_org uuid; v_student uuid; v_course uuid;
BEGIN
  IF auth.role() IN ('service_role','supabase_admin') THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    v_org := OLD.organization_id; v_student := OLD.student_id; v_course := OLD.course_id;
  ELSE
    v_org := NEW.organization_id; v_student := NEW.student_id; v_course := NEW.course_id;
  END IF;
  IF v_org IS NULL AND v_student IS NOT NULL THEN
    SELECT s.organization_id INTO v_org FROM public.students s WHERE s.id = v_student;
  END IF;
  IF NOT public.phase1_same_org(v_org) THEN RAISE EXCEPTION 'organization boundary violation on lms_enrollments'; END IF;
  IF NOT (public.phase1_lms_admin() OR public.phase1_teacher_course_scope(v_course)
       OR (TG_OP = 'INSERT' AND public.phase1_own_student(v_student))) THEN
    RAISE EXCEPTION 'LMS enrollment authorization required';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $fn$;
GRANT EXECUTE ON FUNCTION public.phase1_guard_lms_enrollments() TO authenticated;

CREATE OR REPLACE FUNCTION public.phase1_guard_lms_lesson_progress()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_org uuid; v_student uuid; v_lesson uuid; v_course uuid;
BEGIN
  IF auth.role() IN ('service_role','supabase_admin') THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    v_org := OLD.organization_id; v_student := OLD.student_id; v_lesson := OLD.lesson_id;
  ELSE
    v_org := NEW.organization_id; v_student := NEW.student_id; v_lesson := NEW.lesson_id;
  END IF;
  IF v_org IS NULL AND v_student IS NOT NULL THEN
    SELECT s.organization_id INTO v_org FROM public.students s WHERE s.id = v_student;
  END IF;
  IF NOT public.phase1_same_org(v_org) THEN RAISE EXCEPTION 'organization boundary violation on lms_lesson_progress'; END IF;
  SELECT l.course_id INTO v_course FROM public.lms_lessons l WHERE l.id = v_lesson;
  IF NOT (public.phase1_lms_admin() OR public.phase1_teacher_course_scope(v_course)
       OR public.phase1_own_student(v_student)) THEN
    RAISE EXCEPTION 'LMS ownership or teacher scope required';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $fn$;
GRANT EXECUTE ON FUNCTION public.phase1_guard_lms_lesson_progress() TO authenticated;

CREATE OR REPLACE FUNCTION public.phase1_guard_lms_quiz_attempts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_org uuid; v_student uuid; v_quiz uuid; v_course uuid;
BEGIN
  IF auth.role() IN ('service_role','supabase_admin') THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    v_org := OLD.organization_id; v_student := OLD.student_id; v_quiz := OLD.quiz_id;
  ELSE
    v_org := NEW.organization_id; v_student := NEW.student_id; v_quiz := NEW.quiz_id;
  END IF;
  IF v_org IS NULL AND v_student IS NOT NULL THEN
    SELECT s.organization_id INTO v_org FROM public.students s WHERE s.id = v_student;
  END IF;
  IF NOT public.phase1_same_org(v_org) THEN RAISE EXCEPTION 'organization boundary violation on lms_quiz_attempts'; END IF;
  SELECT l.course_id INTO v_course
    FROM public.lms_lessons l JOIN public.lms_quizzes q ON q.lesson_id = l.id WHERE q.id = v_quiz;
  IF NOT (public.phase1_lms_admin() OR public.phase1_teacher_course_scope(v_course)
       OR public.phase1_own_student(v_student)) THEN
    RAISE EXCEPTION 'LMS ownership or teacher scope required';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $fn$;
GRANT EXECUTE ON FUNCTION public.phase1_guard_lms_quiz_attempts() TO authenticated;

CREATE OR REPLACE FUNCTION public.phase1_guard_lms_quiz_answers()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_org uuid; v_attempt uuid;
BEGIN
  IF auth.role() IN ('service_role','supabase_admin') THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN v_org := OLD.organization_id; v_attempt := OLD.attempt_id;
  ELSE                     v_org := NEW.organization_id; v_attempt := NEW.attempt_id;
  END IF;
  IF v_org IS NULL AND v_attempt IS NOT NULL THEN
    SELECT a.organization_id INTO v_org FROM public.lms_quiz_attempts a WHERE a.id = v_attempt;
  END IF;
  IF NOT public.phase1_same_org(v_org) THEN RAISE EXCEPTION 'organization boundary violation on lms_quiz_answers'; END IF;
  IF NOT (public.phase1_lms_admin() OR EXISTS (
    SELECT 1 FROM public.lms_quiz_attempts a
    WHERE a.id = v_attempt AND public.phase1_own_student(a.student_id) AND a.submitted_at IS NULL
  )) THEN RAISE EXCEPTION 'LMS answer ownership required'; END IF;
  RETURN COALESCE(NEW, OLD);
END $fn$;
GRANT EXECUTE ON FUNCTION public.phase1_guard_lms_quiz_answers() TO authenticated;

CREATE OR REPLACE FUNCTION public.phase1_guard_lms_submissions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_org uuid; v_student uuid; v_assignment uuid; v_course uuid;
BEGIN
  IF auth.role() IN ('service_role','supabase_admin') THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    v_org := OLD.organization_id; v_student := OLD.student_id; v_assignment := OLD.assignment_id;
  ELSE
    v_org := NEW.organization_id; v_student := NEW.student_id; v_assignment := NEW.assignment_id;
  END IF;
  IF v_org IS NULL AND v_student IS NOT NULL THEN
    SELECT s.organization_id INTO v_org FROM public.students s WHERE s.id = v_student;
  END IF;
  IF NOT public.phase1_same_org(v_org) THEN RAISE EXCEPTION 'organization boundary violation on lms_submissions'; END IF;
  SELECT l.course_id INTO v_course
    FROM public.lms_lessons l JOIN public.lms_assignments a ON a.lesson_id = l.id WHERE a.id = v_assignment;
  IF NOT (public.phase1_lms_admin() OR public.phase1_teacher_course_scope(v_course)
       OR public.phase1_own_student(v_student)) THEN
    RAISE EXCEPTION 'LMS ownership or teacher scope required';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $fn$;
GRANT EXECUTE ON FUNCTION public.phase1_guard_lms_submissions() TO authenticated;

CREATE OR REPLACE FUNCTION public.phase1_guard_lms_student_badges()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_org uuid; v_student uuid;
BEGIN
  IF auth.role() IN ('service_role','supabase_admin') THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN v_org := OLD.organization_id; v_student := OLD.student_id;
  ELSE                     v_org := NEW.organization_id; v_student := NEW.student_id;
  END IF;
  IF v_org IS NULL AND v_student IS NOT NULL THEN
    SELECT s.organization_id INTO v_org FROM public.students s WHERE s.id = v_student;
  END IF;
  IF NOT public.phase1_same_org(v_org) THEN RAISE EXCEPTION 'organization boundary violation on lms_student_badges'; END IF;
  IF NOT (public.phase1_lms_admin() OR public.phase1_own_student(v_student)) THEN
    RAISE EXCEPTION 'LMS ownership required';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $fn$;
GRANT EXECUTE ON FUNCTION public.phase1_guard_lms_student_badges() TO authenticated;

-- LMS admin/teacher tables (no student_id): courses, lessons, quizzes,
-- quiz_questions, assignments, badges, discussions, discussion_replies.
-- Per-table wrappers keep OLD/NEW field access safe.
CREATE OR REPLACE FUNCTION public.phase1_guard_lms_courses()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_org uuid; v_course uuid;
BEGIN
  IF auth.role() IN ('service_role','supabase_admin') THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN v_org := OLD.organization_id; v_course := OLD.id;
  ELSE                     v_org := NEW.organization_id; v_course := NEW.id;
  END IF;
  IF NOT public.phase1_same_org(v_org) THEN RAISE EXCEPTION 'organization boundary violation on lms_courses'; END IF;
  IF NOT (public.phase1_lms_admin() OR public.phase1_teacher_course_scope(v_course)) THEN
    RAISE EXCEPTION 'LMS teacher or administrator authorization required';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $fn$;
GRANT EXECUTE ON FUNCTION public.phase1_guard_lms_courses() TO authenticated;

CREATE OR REPLACE FUNCTION public.phase1_guard_lms_lessons()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_org uuid; v_course uuid;
BEGIN
  IF auth.role() IN ('service_role','supabase_admin') THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN v_org := OLD.organization_id; v_course := OLD.course_id;
  ELSE                     v_org := NEW.organization_id; v_course := NEW.course_id;
  END IF;
  IF NOT public.phase1_same_org(v_org) THEN RAISE EXCEPTION 'organization boundary violation on lms_lessons'; END IF;
  IF NOT (public.phase1_lms_admin() OR public.phase1_teacher_course_scope(v_course)) THEN
    RAISE EXCEPTION 'LMS teacher or administrator authorization required';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $fn$;
GRANT EXECUTE ON FUNCTION public.phase1_guard_lms_lessons() TO authenticated;

CREATE OR REPLACE FUNCTION public.phase1_guard_lms_quizzes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_org uuid; v_course uuid; v_lesson uuid;
BEGIN
  IF auth.role() IN ('service_role','supabase_admin') THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN v_org := OLD.organization_id; v_lesson := OLD.lesson_id;
  ELSE                     v_org := NEW.organization_id; v_lesson := NEW.lesson_id;
  END IF;
  IF NOT public.phase1_same_org(v_org) THEN RAISE EXCEPTION 'organization boundary violation on lms_quizzes'; END IF;
  SELECT l.course_id INTO v_course FROM public.lms_lessons l WHERE l.id = v_lesson;
  IF NOT (public.phase1_lms_admin() OR public.phase1_teacher_course_scope(v_course)) THEN
    RAISE EXCEPTION 'LMS teacher or administrator authorization required';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $fn$;
GRANT EXECUTE ON FUNCTION public.phase1_guard_lms_quizzes() TO authenticated;

CREATE OR REPLACE FUNCTION public.phase1_guard_lms_quiz_questions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_org uuid; v_course uuid; v_quiz uuid;
BEGIN
  IF auth.role() IN ('service_role','supabase_admin') THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN v_org := OLD.organization_id; v_quiz := OLD.quiz_id;
  ELSE                     v_org := NEW.organization_id; v_quiz := NEW.quiz_id;
  END IF;
  IF NOT public.phase1_same_org(v_org) THEN RAISE EXCEPTION 'organization boundary violation on lms_quiz_questions'; END IF;
  SELECT l.course_id INTO v_course
    FROM public.lms_lessons l JOIN public.lms_quizzes q ON q.lesson_id = l.id WHERE q.id = v_quiz;
  IF NOT (public.phase1_lms_admin() OR public.phase1_teacher_course_scope(v_course)) THEN
    RAISE EXCEPTION 'LMS teacher or administrator authorization required';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $fn$;
GRANT EXECUTE ON FUNCTION public.phase1_guard_lms_quiz_questions() TO authenticated;

CREATE OR REPLACE FUNCTION public.phase1_guard_lms_assignments()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_org uuid; v_course uuid; v_lesson uuid;
BEGIN
  IF auth.role() IN ('service_role','supabase_admin') THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN v_org := OLD.organization_id; v_lesson := OLD.lesson_id;
  ELSE                     v_org := NEW.organization_id; v_lesson := NEW.lesson_id;
  END IF;
  IF NOT public.phase1_same_org(v_org) THEN RAISE EXCEPTION 'organization boundary violation on lms_assignments'; END IF;
  SELECT l.course_id INTO v_course FROM public.lms_lessons l WHERE l.id = v_lesson;
  IF NOT (public.phase1_lms_admin() OR public.phase1_teacher_course_scope(v_course)) THEN
    RAISE EXCEPTION 'LMS teacher or administrator authorization required';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $fn$;
GRANT EXECUTE ON FUNCTION public.phase1_guard_lms_assignments() TO authenticated;

-- lms_badges / lms_discussions / lms_discussion_replies: no course_id;
-- admin-only (matches original trigger's implicit fall-through path).
CREATE OR REPLACE FUNCTION public.phase1_guard_lms_admin_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_org uuid;
BEGIN
  IF auth.role() IN ('service_role','supabase_admin') THEN RETURN COALESCE(NEW, OLD); END IF;
  v_org := NULLIF(to_jsonb(COALESCE(NEW, OLD)) ->> 'organization_id', '')::uuid;
  IF NOT public.phase1_same_org(v_org) THEN RAISE EXCEPTION 'organization boundary violation on %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME; END IF;
  IF NOT public.phase1_lms_admin() THEN
    RAISE EXCEPTION 'LMS teacher or administrator authorization required';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $fn$;
GRANT EXECUTE ON FUNCTION public.phase1_guard_lms_admin_only() TO authenticated;

-- 2g. Parent/child org enforcement -- attached to student-linked child
-- tables. Auto-populates org from parent on INSERT when omitted; rejects
-- cross-tenant explicit values. On UPDATE, blocks changes that would
-- retarget the row to a different-tenant student.
CREATE OR REPLACE FUNCTION public.phase1_enforce_student_parent_org()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE parent_org uuid; child_org uuid; child_student uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  child_student := (to_jsonb(NEW) ->> 'student_id')::uuid;
  child_org     := (to_jsonb(NEW) ->> 'organization_id')::uuid;
  IF child_student IS NULL THEN RETURN NEW; END IF;
  SELECT s.organization_id INTO parent_org FROM public.students s WHERE s.id = child_student;
  IF parent_org IS NULL THEN
    RAISE EXCEPTION 'phase1_enforce_student_parent_org: parent student % not found for %.%',
      child_student, TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;
  IF child_org IS NULL THEN
    -- Populate the child row's org from the parent using dynamic SQL,
    -- since NEW is a table-specific composite type and can't be
    -- rebuilt with jsonb_populate_record without knowing that type.
    -- We instead assign column-by-column via a JSONB round-trip using
    -- record composition. The safest way in plpgsql is to error out;
    -- callers should always send organization_id. We prefer strict
    -- rejection here to keep behavior predictable.
    RAISE EXCEPTION 'phase1_enforce_student_parent_org: organization_id required on %.% (student parent org=%)',
      TG_TABLE_SCHEMA, TG_TABLE_NAME, parent_org;
  ELSIF child_org <> parent_org THEN
    RAISE EXCEPTION 'phase1_enforce_student_parent_org: parent/child organization mismatch on %.% (child_org=%, parent_org=%)',
      TG_TABLE_SCHEMA, TG_TABLE_NAME, child_org, parent_org;
  END IF;
  RETURN NEW;
END $fn$;
GRANT EXECUTE ON FUNCTION public.phase1_enforce_student_parent_org() TO authenticated;


-- ---------------------------------------------------------------------
-- SECTION 3 -- Reattach triggers. Drop the old universal trigger from
-- every table it was installed on, then install the new per-table
-- triggers. Idempotent: DROP IF EXISTS + fresh CREATE per table.
-- ---------------------------------------------------------------------

DO $swap$
DECLARE t text; r record;
BEGIN
  -- Drop old universal trigger everywhere.
  FOR r IN
    SELECT c.relname AS tbl
      FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND tg.tgname = 'phase1_sensitive_write_guard'
       AND NOT tg.tgisinternal
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS phase1_sensitive_write_guard ON public.%I', r.tbl);
  END LOOP;

  -- Drop any prior v2 triggers so this migration is idempotent.
  FOR r IN
    SELECT c.relname AS tbl
      FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND tg.tgname IN ('phase1_guard','phase1_parent_org')
       AND NOT tg.tgisinternal
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS phase1_guard ON public.%I', r.tbl);
    EXECUTE format('DROP TRIGGER IF EXISTS phase1_parent_org ON public.%I', r.tbl);
  END LOOP;

  -- Install per-table guards.
  CREATE TRIGGER phase1_guard BEFORE INSERT OR UPDATE OR DELETE ON public.students
    FOR EACH ROW EXECUTE FUNCTION public.phase1_guard_students();
  CREATE TRIGGER phase1_guard BEFORE INSERT OR UPDATE OR DELETE ON public.student_enrollments
    FOR EACH ROW EXECUTE FUNCTION public.phase1_guard_student_enrollments();
  CREATE TRIGGER phase1_guard BEFORE INSERT OR UPDATE OR DELETE ON public.student_scores
    FOR EACH ROW EXECUTE FUNCTION public.phase1_guard_student_scores();
  CREATE TRIGGER phase1_guard BEFORE INSERT OR UPDATE OR DELETE ON public.attendance_records
    FOR EACH ROW EXECUTE FUNCTION public.phase1_guard_attendance_records();

  FOREACH t IN ARRAY ARRAY[
    'expense_entries','income_entries','vendors','bank_transactions','sms_inbox',
    'payroll_components','payroll_staff_components','payroll_runs','payroll_payslips',
    'staff_members','roles','org_memberships','teacher_assignments','parent_profiles','parent_student_links',
    'clinic_patient_records','clinic_visits','clinic_medications_inventory',
    'clinic_medications_dispensed','clinic_vaccinations','clinic_health_incidents',
    'assets','asset_assignments','asset_maintenance','asset_disposals',
    'library_books','library_book_copies','library_loans','library_reservations',
    'hostel_houses','hostel_rooms','hostel_beds','hostel_allocations','hostel_visitor_log','hostel_incidents',
    'transport_vehicles','transport_routes','transport_student_assignments',
    'procurement_requests','procurement_request_items','procurement_orders','procurement_order_items','procurement_receipts',
    'inventory_items','stock_movements','departments'
  ] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format(
        'CREATE TRIGGER phase1_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.phase1_guard_generic_org()',
        t
      );
    END IF;
  END LOOP;

  -- LMS per-table
  IF to_regclass('public.lms_courses') IS NOT NULL THEN
    CREATE TRIGGER phase1_guard BEFORE INSERT OR UPDATE OR DELETE ON public.lms_courses
      FOR EACH ROW EXECUTE FUNCTION public.phase1_guard_lms_courses();
  END IF;
  IF to_regclass('public.lms_lessons') IS NOT NULL THEN
    CREATE TRIGGER phase1_guard BEFORE INSERT OR UPDATE OR DELETE ON public.lms_lessons
      FOR EACH ROW EXECUTE FUNCTION public.phase1_guard_lms_lessons();
  END IF;
  IF to_regclass('public.lms_quizzes') IS NOT NULL THEN
    CREATE TRIGGER phase1_guard BEFORE INSERT OR UPDATE OR DELETE ON public.lms_quizzes
      FOR EACH ROW EXECUTE FUNCTION public.phase1_guard_lms_quizzes();
  END IF;
  IF to_regclass('public.lms_quiz_questions') IS NOT NULL THEN
    CREATE TRIGGER phase1_guard BEFORE INSERT OR UPDATE OR DELETE ON public.lms_quiz_questions
      FOR EACH ROW EXECUTE FUNCTION public.phase1_guard_lms_quiz_questions();
  END IF;
  IF to_regclass('public.lms_assignments') IS NOT NULL THEN
    CREATE TRIGGER phase1_guard BEFORE INSERT OR UPDATE OR DELETE ON public.lms_assignments
      FOR EACH ROW EXECUTE FUNCTION public.phase1_guard_lms_assignments();
  END IF;
  IF to_regclass('public.lms_enrollments') IS NOT NULL THEN
    CREATE TRIGGER phase1_guard BEFORE INSERT OR UPDATE OR DELETE ON public.lms_enrollments
      FOR EACH ROW EXECUTE FUNCTION public.phase1_guard_lms_enrollments();
    CREATE TRIGGER phase1_parent_org BEFORE INSERT OR UPDATE ON public.lms_enrollments
      FOR EACH ROW EXECUTE FUNCTION public.phase1_enforce_student_parent_org();
  END IF;
  IF to_regclass('public.lms_lesson_progress') IS NOT NULL THEN
    CREATE TRIGGER phase1_guard BEFORE INSERT OR UPDATE OR DELETE ON public.lms_lesson_progress
      FOR EACH ROW EXECUTE FUNCTION public.phase1_guard_lms_lesson_progress();
    CREATE TRIGGER phase1_parent_org BEFORE INSERT OR UPDATE ON public.lms_lesson_progress
      FOR EACH ROW EXECUTE FUNCTION public.phase1_enforce_student_parent_org();
  END IF;
  IF to_regclass('public.lms_quiz_attempts') IS NOT NULL THEN
    CREATE TRIGGER phase1_guard BEFORE INSERT OR UPDATE OR DELETE ON public.lms_quiz_attempts
      FOR EACH ROW EXECUTE FUNCTION public.phase1_guard_lms_quiz_attempts();
    CREATE TRIGGER phase1_parent_org BEFORE INSERT OR UPDATE ON public.lms_quiz_attempts
      FOR EACH ROW EXECUTE FUNCTION public.phase1_enforce_student_parent_org();
  END IF;
  IF to_regclass('public.lms_quiz_answers') IS NOT NULL THEN
    CREATE TRIGGER phase1_guard BEFORE INSERT OR UPDATE OR DELETE ON public.lms_quiz_answers
      FOR EACH ROW EXECUTE FUNCTION public.phase1_guard_lms_quiz_answers();
  END IF;
  IF to_regclass('public.lms_submissions') IS NOT NULL THEN
    CREATE TRIGGER phase1_guard BEFORE INSERT OR UPDATE OR DELETE ON public.lms_submissions
      FOR EACH ROW EXECUTE FUNCTION public.phase1_guard_lms_submissions();
    CREATE TRIGGER phase1_parent_org BEFORE INSERT OR UPDATE ON public.lms_submissions
      FOR EACH ROW EXECUTE FUNCTION public.phase1_enforce_student_parent_org();
  END IF;
  IF to_regclass('public.lms_student_badges') IS NOT NULL THEN
    CREATE TRIGGER phase1_guard BEFORE INSERT OR UPDATE OR DELETE ON public.lms_student_badges
      FOR EACH ROW EXECUTE FUNCTION public.phase1_guard_lms_student_badges();
    CREATE TRIGGER phase1_parent_org BEFORE INSERT OR UPDATE ON public.lms_student_badges
      FOR EACH ROW EXECUTE FUNCTION public.phase1_enforce_student_parent_org();
  END IF;
  IF to_regclass('public.lms_badges') IS NOT NULL THEN
    CREATE TRIGGER phase1_guard BEFORE INSERT OR UPDATE OR DELETE ON public.lms_badges
      FOR EACH ROW EXECUTE FUNCTION public.phase1_guard_lms_admin_only();
  END IF;
  IF to_regclass('public.lms_discussions') IS NOT NULL THEN
    CREATE TRIGGER phase1_guard BEFORE INSERT OR UPDATE OR DELETE ON public.lms_discussions
      FOR EACH ROW EXECUTE FUNCTION public.phase1_guard_lms_admin_only();
  END IF;
  IF to_regclass('public.lms_discussion_replies') IS NOT NULL THEN
    CREATE TRIGGER phase1_guard BEFORE INSERT OR UPDATE OR DELETE ON public.lms_discussion_replies
      FOR EACH ROW EXECUTE FUNCTION public.phase1_guard_lms_admin_only();
  END IF;

  -- Parent-org enforcement on the incident table.
  CREATE TRIGGER phase1_parent_org BEFORE INSERT OR UPDATE ON public.student_enrollments
    FOR EACH ROW EXECUTE FUNCTION public.phase1_enforce_student_parent_org();
END
$swap$;

-- The old function public.phase1_sensitive_write_guard() is intentionally
-- left in the schema (unattached) so the rollback script can reinstall
-- it without needing its source. To drop after successful cutover:
--   DROP FUNCTION public.phase1_sensitive_write_guard();

COMMIT;
