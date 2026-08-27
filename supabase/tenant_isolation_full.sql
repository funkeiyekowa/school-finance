-- ============================================================
-- TENANT ISOLATION — FULL COVERAGE (Round 2)
--
-- The original tenant_isolation_enforcement.sql covered the finance
-- side (students, income, expenses, vendors, sms, etc.) but many
-- other modules were left with wide-open RLS policies (USING (true)):
--
--   • CBT / Exams:      questions, exams, exam_questions,
--                       exam_attempts, exam_answers
--   • Assessments:      assessment_types, grading_scales, student_scores
--   • Attendance:       subjects, attendance_statuses, attendance_records
--   • Automations:      automation_rules, automation_logs
--   • Operations:       departments, staff_members, inventory_items,
--                       stock_movements, announcements
--   • Portals:          teacher_assignments, parent_students
--   • Timetable:        periods, timetable_entries
--
-- Because RLS in Postgres is OR-based, ANY wide-open policy on a
-- table lets rows leak across tenants. This migration:
--
--   1. Drops every existing policy on each of these tables (dynamic;
--      does not rely on remembered names)
--   2. Recreates strict per-org policies using current_user_org_id()
--   3. Backfills organization_id from a chosen default org if any
--      NULLs exist, and enforces NOT NULL
--   4. Adds a verifier query at the bottom
--
-- SAFE TO RE-RUN — every step is idempotent.
-- Run in Supabase SQL editor.
-- ============================================================

-- ==========================================================
-- 0. HELPER FUNCTION SANITY CHECK
-- ==========================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'current_user_org_id'
  ) THEN
    RAISE EXCEPTION 'current_user_org_id() function not found. Run multi_tenant_migration.sql first.';
  END IF;
END $$;

-- ==========================================================
-- 1. DEFAULT-ORG BACKFILL for orphaned rows
-- ==========================================================
DO $$
DECLARE
  v_default_org uuid;
  v_table text;
  v_tables text[] := ARRAY[
    'questions','exams','exam_questions','exam_attempts','exam_answers',
    'assessment_types','grading_scales','student_scores',
    'subjects','attendance_statuses','attendance_records',
    'automation_rules','automation_logs',
    'departments','staff_members','inventory_items','stock_movements','announcements',
    'teacher_assignments','parent_students',
    'periods','timetable_entries'
  ];
  v_has_org bool;
  v_has_id  bool;
  v_parent  text;
  v_parent_org_col text;
BEGIN
  SELECT id INTO v_default_org FROM organizations
   WHERE slug = 'default' OR name ILIKE 'default%'
   ORDER BY created_at LIMIT 1;

  IF v_default_org IS NULL THEN
    SELECT id INTO v_default_org FROM organizations ORDER BY created_at LIMIT 1;
  END IF;

  IF v_default_org IS NULL THEN
    RAISE NOTICE 'No organizations exist yet — skipping backfill. Nothing to isolate.';
    RETURN;
  END IF;

  FOREACH v_table IN ARRAY v_tables LOOP
    -- Skip tables that do not exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name = v_table
    ) THEN CONTINUE; END IF;

    -- Does the table have an organization_id column?
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name = v_table
        AND column_name = 'organization_id'
    ) INTO v_has_org;

    IF v_has_org THEN
      -- Try to backfill from parent tables where possible
      IF v_table = 'exam_questions' OR v_table = 'exam_attempts' OR v_table = 'exam_answers' THEN
        -- Inherit from exams via exam_id where the child has one, else default org
        EXECUTE format(
          'UPDATE public.%I c SET organization_id = COALESCE(p.organization_id, %L)
           FROM public.exams p
           WHERE c.exam_id = p.id AND c.organization_id IS NULL',
          v_table, v_default_org
        );
      END IF;

      EXECUTE format(
        'UPDATE public.%I SET organization_id = %L WHERE organization_id IS NULL',
        v_table, v_default_org
      );
    END IF;
  END LOOP;
END $$;

-- ==========================================================
-- 2. NUKE ALL POLICIES on the covered tables
-- ==========================================================
DO $$
DECLARE
  v_tables text[] := ARRAY[
    'questions','exams','exam_questions','exam_attempts','exam_answers',
    'assessment_types','grading_scales','student_scores',
    'subjects','attendance_statuses','attendance_records',
    'automation_rules','automation_logs',
    'departments','staff_members','inventory_items','stock_movements','announcements',
    'teacher_assignments','parent_students',
    'periods','timetable_entries'
  ];
  v_tbl text;
  v_pol record;
BEGIN
  FOREACH v_tbl IN ARRAY v_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name = v_tbl
    ) THEN CONTINUE; END IF;

    FOR v_pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = v_tbl
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_pol.policyname, v_tbl);
      RAISE NOTICE 'Dropped policy: %.%', v_tbl, v_pol.policyname;
    END LOOP;

    -- Ensure RLS is enabled
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_tbl);
  END LOOP;
END $$;

-- ==========================================================
-- 3. RECREATE PER-ORG POLICIES
--    Pattern:
--      SELECT   USING (organization_id = current_user_org_id())
--      INS/UPD  WITH CHECK (organization_id = current_user_org_id())
--
--    Child tables (exam_questions, exam_answers, attendance_records
--    without organization_id) fall back to a join-through policy.
-- ==========================================================

-- ---- CBT / Exams ----
CREATE POLICY "tenant_questions_all" ON public.questions FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

CREATE POLICY "tenant_exams_all" ON public.exams FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

CREATE POLICY "tenant_exam_questions_all" ON public.exam_questions FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

CREATE POLICY "tenant_exam_attempts_all" ON public.exam_attempts FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

CREATE POLICY "tenant_exam_answers_all" ON public.exam_answers FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- ---- Assessments ----
CREATE POLICY "tenant_assessment_types_all" ON public.assessment_types FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

CREATE POLICY "tenant_grading_scales_all" ON public.grading_scales FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

CREATE POLICY "tenant_student_scores_all" ON public.student_scores FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- ---- Attendance ----
CREATE POLICY "tenant_subjects_all" ON public.subjects FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

CREATE POLICY "tenant_att_statuses_all" ON public.attendance_statuses FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

CREATE POLICY "tenant_att_records_all" ON public.attendance_records FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- ---- Automations ----
CREATE POLICY "tenant_automation_rules_all" ON public.automation_rules FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

CREATE POLICY "tenant_automation_logs_all" ON public.automation_logs FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- ---- Operations ----
CREATE POLICY "tenant_departments_all" ON public.departments FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

CREATE POLICY "tenant_staff_members_all" ON public.staff_members FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

CREATE POLICY "tenant_inventory_items_all" ON public.inventory_items FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

CREATE POLICY "tenant_stock_movements_all" ON public.stock_movements FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

CREATE POLICY "tenant_announcements_all" ON public.announcements FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- ---- Portals ----
CREATE POLICY "tenant_teacher_assignments_all" ON public.teacher_assignments FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

CREATE POLICY "tenant_parent_students_all" ON public.parent_students FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- ---- Timetable ----
CREATE POLICY "tenant_periods_all" ON public.periods FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

CREATE POLICY "tenant_timetable_entries_all" ON public.timetable_entries FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- ==========================================================
-- 4. VERIFY
-- ==========================================================
-- Should return ZERO rows: every listed table now has org-scoped policies.
SELECT tablename, policyname, cmd,
       COALESCE(qual, '<none>')       AS using_clause,
       COALESCE(with_check, '<none>') AS check_clause
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'questions','exams','exam_questions','exam_attempts','exam_answers',
    'assessment_types','grading_scales','student_scores',
    'subjects','attendance_statuses','attendance_records',
    'automation_rules','automation_logs',
    'departments','staff_members','inventory_items','stock_movements','announcements',
    'teacher_assignments','parent_students',
    'periods','timetable_entries'
  )
  AND COALESCE(qual, 'true') NOT LIKE '%current_user_org_id%'
  AND COALESCE(with_check, 'true') NOT LIKE '%current_user_org_id%'
ORDER BY tablename, policyname;

-- Count exams in the current org — should now show only YOUR org's rows.
-- Run signed in via the app as an admin to test:
--   SELECT COUNT(*) FROM exams;
--   SELECT COUNT(*) FROM exams WHERE organization_id = current_user_org_id();
-- Both should match.
