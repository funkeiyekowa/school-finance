-- ============================================================
-- TENANT ISOLATION — FULL COVERAGE (Round 2, defensive)
--
-- Closes SaaS RLS leaks on modules whose original migrations
-- shipped with USING (true) policies:
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
-- Steps:
--   1. Add organization_id to any table that is missing it
--      (ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...).
--   2. Backfill NULLs — from a parent when the child clearly
--      inherits (exam_questions/exam_attempts/exam_answers via
--      exams; stock_movements via inventory_items), then the
--      default org as a fallback.
--   3. Drop every existing policy on each target table (dynamic;
--      does not depend on remembered names).
--   4. Recreate strict per-org policies via current_user_org_id().
--   5. Verifier query.
--
-- SAFE TO RE-RUN. Run in the Supabase SQL editor.
-- ============================================================

-- ==========================================================
-- 0. HELPER FUNCTION SANITY CHECK
-- ==========================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_user_org_id') THEN
    RAISE EXCEPTION 'current_user_org_id() not found. Run multi_tenant_migration.sql first.';
  END IF;
END $$;

-- ==========================================================
-- 1. ADD organization_id where missing
-- ==========================================================
DO $$
DECLARE
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
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name = v_table
    ) THEN
      RAISE NOTICE 'skip: table % does not exist', v_table;
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE',
      v_table
    );
  END LOOP;
END $$;

-- ==========================================================
-- 2. BACKFILL organization_id
-- ==========================================================
DO $$
DECLARE
  v_default_org uuid;
BEGIN
  SELECT id INTO v_default_org FROM organizations
    WHERE slug = 'default' OR name ILIKE 'default%'
    ORDER BY created_at LIMIT 1;
  IF v_default_org IS NULL THEN
    SELECT id INTO v_default_org FROM organizations ORDER BY created_at LIMIT 1;
  END IF;

  IF v_default_org IS NULL THEN
    RAISE NOTICE 'no organizations exist yet — skipping backfill';
    RETURN;
  END IF;

  -- CBT children inherit from exams
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='exam_questions') THEN
    UPDATE public.exam_questions c
       SET organization_id = COALESCE(p.organization_id, v_default_org)
      FROM public.exams p
     WHERE c.exam_id = p.id AND c.organization_id IS NULL;
    UPDATE public.exam_questions SET organization_id = v_default_org WHERE organization_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='exam_attempts') THEN
    UPDATE public.exam_attempts c
       SET organization_id = COALESCE(p.organization_id, v_default_org)
      FROM public.exams p
     WHERE c.exam_id = p.id AND c.organization_id IS NULL;
    UPDATE public.exam_attempts SET organization_id = v_default_org WHERE organization_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='exam_answers') THEN
    UPDATE public.exam_answers c
       SET organization_id = COALESCE(p.organization_id, v_default_org)
      FROM public.exam_attempts p
     WHERE c.attempt_id = p.id AND c.organization_id IS NULL;
    UPDATE public.exam_answers SET organization_id = v_default_org WHERE organization_id IS NULL;
  END IF;

  -- stock movements inherit from inventory_items
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='stock_movements')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='inventory_items') THEN
    UPDATE public.stock_movements c
       SET organization_id = COALESCE(p.organization_id, v_default_org)
      FROM public.inventory_items p
     WHERE c.item_id = p.id AND c.organization_id IS NULL;
    UPDATE public.stock_movements SET organization_id = v_default_org WHERE organization_id IS NULL;
  END IF;

  -- Everything else: just default-org backfill
  UPDATE public.questions             SET organization_id = v_default_org WHERE organization_id IS NULL;
  UPDATE public.exams                 SET organization_id = v_default_org WHERE organization_id IS NULL;
  UPDATE public.assessment_types      SET organization_id = v_default_org WHERE organization_id IS NULL;
  UPDATE public.grading_scales        SET organization_id = v_default_org WHERE organization_id IS NULL;
  UPDATE public.student_scores        SET organization_id = v_default_org WHERE organization_id IS NULL;
  UPDATE public.subjects              SET organization_id = v_default_org WHERE organization_id IS NULL;
  UPDATE public.attendance_statuses   SET organization_id = v_default_org WHERE organization_id IS NULL;
  UPDATE public.attendance_records    SET organization_id = v_default_org WHERE organization_id IS NULL;
  UPDATE public.automation_rules      SET organization_id = v_default_org WHERE organization_id IS NULL;
  UPDATE public.automation_logs       SET organization_id = v_default_org WHERE organization_id IS NULL;
  UPDATE public.departments           SET organization_id = v_default_org WHERE organization_id IS NULL;
  UPDATE public.staff_members         SET organization_id = v_default_org WHERE organization_id IS NULL;
  UPDATE public.inventory_items       SET organization_id = v_default_org WHERE organization_id IS NULL;
  UPDATE public.announcements         SET organization_id = v_default_org WHERE organization_id IS NULL;
  UPDATE public.teacher_assignments   SET organization_id = v_default_org WHERE organization_id IS NULL;
  UPDATE public.parent_students       SET organization_id = v_default_org WHERE organization_id IS NULL;
  UPDATE public.periods               SET organization_id = v_default_org WHERE organization_id IS NULL;
  UPDATE public.timetable_entries     SET organization_id = v_default_org WHERE organization_id IS NULL;
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'skip: one of the tables above does not exist yet — safe to ignore';
END $$;

-- Optional: enforce NOT NULL going forward (skip individual failures)
DO $$
DECLARE
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
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name = v_table
    ) THEN CONTINUE; END IF;
    BEGIN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN organization_id SET NOT NULL', v_table);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'skip NOT NULL on %: %', v_table, SQLERRM;
    END;
  END LOOP;
END $$;

-- ==========================================================
-- 3. NUKE existing policies on the covered tables
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
    END LOOP;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_tbl);
  END LOOP;
END $$;

-- ==========================================================
-- 4. RECREATE STRICT PER-ORG POLICIES
-- ==========================================================
-- CBT
CREATE POLICY tenant_questions_all      ON public.questions      FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());
CREATE POLICY tenant_exams_all          ON public.exams          FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());
CREATE POLICY tenant_exam_questions_all ON public.exam_questions FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());
CREATE POLICY tenant_exam_attempts_all  ON public.exam_attempts  FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());
CREATE POLICY tenant_exam_answers_all   ON public.exam_answers   FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- Assessments
CREATE POLICY tenant_assessment_types_all ON public.assessment_types FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());
CREATE POLICY tenant_grading_scales_all   ON public.grading_scales   FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());
CREATE POLICY tenant_student_scores_all   ON public.student_scores   FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- Attendance
CREATE POLICY tenant_subjects_all         ON public.subjects           FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());
CREATE POLICY tenant_att_statuses_all     ON public.attendance_statuses FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());
CREATE POLICY tenant_att_records_all      ON public.attendance_records FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- Automations
CREATE POLICY tenant_automation_rules_all ON public.automation_rules FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());
CREATE POLICY tenant_automation_logs_all  ON public.automation_logs  FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- Operations
CREATE POLICY tenant_departments_all      ON public.departments      FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());
CREATE POLICY tenant_staff_members_all    ON public.staff_members    FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());
CREATE POLICY tenant_inventory_items_all  ON public.inventory_items  FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());
CREATE POLICY tenant_stock_movements_all  ON public.stock_movements  FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());
CREATE POLICY tenant_announcements_all    ON public.announcements    FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- Portals
CREATE POLICY tenant_teacher_assignments_all ON public.teacher_assignments FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());
CREATE POLICY tenant_parent_students_all     ON public.parent_students     FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- Timetable
CREATE POLICY tenant_periods_all            ON public.periods            FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());
CREATE POLICY tenant_timetable_entries_all  ON public.timetable_entries  FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- ==========================================================
-- 5. VERIFY — should return zero rows
-- ==========================================================
SELECT tablename, policyname, cmd
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
