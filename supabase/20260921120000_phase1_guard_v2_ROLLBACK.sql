-- =====================================================================
-- ROLLBACK for supabase/20260921120000_phase1_guard_v2.sql
--
-- Restores the pre-v2 state:
--   - drops every v2 per-table trigger + trigger function;
--   - reattaches the original phase1_sensitive_write_guard trigger to
--     every table that had it before.
--
-- NOT rolled back (safe by design):
--   - Section 1's UPDATE on child.organization_id from parent
--     students/lms_quiz_attempts. Every UPDATE copied from the row's
--     own existing FK parent, so no cross-tenant contamination is
--     possible. Reverting to NULL would re-introduce the latent bug.
--     If a specific set of ids needs to be reverted, snapshot them
--     from the audit query and UPDATE ... SET organization_id = NULL
--     WHERE id IN (...) manually.
--
-- The original phase1_sensitive_write_guard() function body is
-- preserved in the schema (unattached) by the v2 migration, so this
-- rollback does not need to reconstruct the function source. If the
-- v2 cutover has already run "DROP FUNCTION phase1_sensitive_write_guard()"
-- then re-run supabase/20260905120000_phase1_security_enforcement.sql
-- from the point of the CREATE OR REPLACE FUNCTION statement onward,
-- or re-apply that migration in full, before running this rollback.
-- =====================================================================

BEGIN;

-- Drop v2 triggers everywhere they were installed.
DO $$
DECLARE r record;
BEGIN
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
END $$;

-- Drop the v2 trigger functions.
DROP FUNCTION IF EXISTS public.phase1_guard_generic_org();
DROP FUNCTION IF EXISTS public.phase1_guard_students();
DROP FUNCTION IF EXISTS public.phase1_guard_student_enrollments();
DROP FUNCTION IF EXISTS public.phase1_guard_student_scores();
DROP FUNCTION IF EXISTS public.phase1_guard_attendance_records();
DROP FUNCTION IF EXISTS public.phase1_guard_lms_enrollments();
DROP FUNCTION IF EXISTS public.phase1_guard_lms_lesson_progress();
DROP FUNCTION IF EXISTS public.phase1_guard_lms_quiz_attempts();
DROP FUNCTION IF EXISTS public.phase1_guard_lms_quiz_answers();
DROP FUNCTION IF EXISTS public.phase1_guard_lms_submissions();
DROP FUNCTION IF EXISTS public.phase1_guard_lms_student_badges();
DROP FUNCTION IF EXISTS public.phase1_guard_lms_courses();
DROP FUNCTION IF EXISTS public.phase1_guard_lms_lessons();
DROP FUNCTION IF EXISTS public.phase1_guard_lms_quizzes();
DROP FUNCTION IF EXISTS public.phase1_guard_lms_quiz_questions();
DROP FUNCTION IF EXISTS public.phase1_guard_lms_assignments();
DROP FUNCTION IF EXISTS public.phase1_guard_lms_admin_only();
DROP FUNCTION IF EXISTS public.phase1_enforce_student_parent_org();

-- Reinstall the original universal trigger on the same table set as
-- supabase/20260905120000_phase1_security_enforcement.sql lines 761-782.
DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'phase1_sensitive_write_guard') THEN
    RAISE EXCEPTION 'phase1_sensitive_write_guard function is missing; re-apply supabase/20260905120000_phase1_security_enforcement.sql before running this rollback';
  END IF;

  FOREACH t IN ARRAY ARRAY[
    'students','student_enrollments','student_scores','attendance_records',
    'income_entries','expense_entries','vendors','bank_transactions','sms_inbox',
    'staff_members','roles','org_memberships','teacher_assignments','parent_profiles','parent_student_links',
    'lms_courses','lms_lessons','lms_enrollments','lms_lesson_progress','lms_quizzes','lms_quiz_questions',
    'lms_quiz_attempts','lms_quiz_answers','lms_assignments','lms_submissions','lms_badges','lms_student_badges',
    'lms_discussions','lms_discussion_replies',
    'clinic_patient_records','clinic_visits','clinic_medications_inventory','clinic_medications_dispensed','clinic_vaccinations','clinic_health_incidents',
    'payroll_components','payroll_staff_components','payroll_runs','payroll_payslips',
    'assets','asset_assignments','asset_maintenance','asset_disposals',
    'library_books','library_book_copies','library_loans','library_reservations',
    'hostel_houses','hostel_rooms','hostel_beds','hostel_allocations','hostel_visitor_log','hostel_incidents',
    'transport_vehicles','transport_routes','transport_student_assignments',
    'procurement_requests','procurement_request_items','procurement_orders','procurement_order_items','procurement_receipts',
    'inventory_items','stock_movements','departments'
  ] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS phase1_sensitive_write_guard ON public.%I', t);
      EXECUTE format('CREATE TRIGGER phase1_sensitive_write_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.phase1_sensitive_write_guard()', t);
    END IF;
  END LOOP;
END $$;

COMMIT;
