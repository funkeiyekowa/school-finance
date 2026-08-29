-- =====================================================================
-- ROLE-SCOPED ACCESS  (critical production security fix)
-- =====================================================================
-- PROBLEM (confirmed live):
--   tenant_isolation_enforcement.sql and tenant_isolation_full.sql
--   locked every tenant table with
--       FOR ALL USING (organization_id = current_user_org_id())
--   which is correct for STAFF. But student_visibility_fixes.sql then
--   gave every student (and parent) a default, active org_memberships
--   row so their portal could resolve current_user_org_id(). The
--   unintended consequence: a signed-in STUDENT now satisfies that
--   org-wide policy and can read EVERY row in the school —
--   other students' scores, attendance and exam attempts, every
--   family's fee payments, staff salaries, the question bank, etc.
--
--   Verified: student S069 could read 101 students, 14 income_entries,
--   8 staff_members, 11 exam_attempts, all attendance and scores.
--
-- FIX:
--   1. is_staff_user()  — true for staff-type roles, false for
--      students/parents. Org-wide policies now require it.
--   2. my_linked_student_ids() — the set of student rows the caller
--      owns: their own (student) or their children (parent).
--   3. Rewrite every SENSITIVE table's policy to
--        USING (organization_id = current_user_org_id() AND is_staff_user())
--      then add narrow SELF/CHILDREN read policies so students and
--      parents still see exactly their own data.
--   4. Reference/config tables (classes, subjects, terms, periods,
--      grading, announcements) stay readable by any active member
--      (needed to render the portals) but writable only by staff.
--
-- Postgres OR's permissive policies per command, so a student matches
-- ONLY the self policies while staff match the org policy — no overlap
-- leak. All helpers are SECURITY DEFINER so they bypass RLS and cannot
-- recurse.
--
-- IDEMPOTENT. Safe to re-run. Run AFTER all prior tenant-isolation
-- migrations (it is the reconciling final word on access).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Helpers
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_staff_user()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM org_memberships m
      WHERE m.user_id = auth.uid()
        AND m.active = true
        AND m.role IN ('owner','admin','editor','staff','bursar',
                       'accountant','developer','super_admin','teacher','viewer')
    )
    OR EXISTS (
      -- Legacy single-school installs that predate org_memberships.
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND COALESCE(p.active, true) = true
        AND p.role IN ('owner','admin','editor','staff','bursar',
                       'accountant','developer','super_admin','teacher','viewer')
    );
$$;
GRANT EXECUTE ON FUNCTION public.is_staff_user() TO authenticated;

-- Every student row the caller is entitled to see as their own:
--   - as a student: their own row (students.profile_id = auth.uid())
--   - as a parent: children linked via parent_profiles/parent_student_links
CREATE OR REPLACE FUNCTION public.my_linked_student_ids()
RETURNS TABLE (student_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT s.id FROM students s WHERE s.profile_id = auth.uid()
  UNION
  SELECT psl.student_id
  FROM parent_profiles pp
  JOIN parent_student_links psl ON psl.parent_id = pp.id
  WHERE pp.profile_id = auth.uid();
$$;
GRANT EXECUTE ON FUNCTION public.my_linked_student_ids() TO authenticated;

-- ---------------------------------------------------------------------
-- 1. Generic re-policy helper: drop all policies on a table, enable RLS.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._reset_policies(p_table text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name=p_table) THEN
    RETURN;
  END IF;
  FOR r IN SELECT policyname FROM pg_policies
           WHERE schemaname='public' AND tablename=p_table LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, p_table);
  END LOOP;
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', p_table);
END $$;

-- =====================================================================
-- 2. SENSITIVE, STAFF-ONLY tables (no student/parent access at all)
-- =====================================================================
DO $$
DECLARE
  t text;
  staff_only text[] := ARRAY[
    'expense_entries','vendors','bank_transactions','sms_inbox',
    'staff_members','departments','inventory_items','stock_movements',
    'automation_rules','automation_logs','roles','categories',
    'promotion_batches','promotion_events',
    'assessment_types',
    'website_submissions'
  ];
BEGIN
  FOREACH t IN ARRAY staff_only LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema='public' AND table_name=t) THEN CONTINUE; END IF;
    PERFORM public._reset_policies(t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR ALL
      USING (organization_id = current_user_org_id() AND public.is_staff_user())
      WITH CHECK (organization_id = current_user_org_id() AND public.is_staff_user())
    $f$, t || '_staff_all', t);
  END LOOP;
END $$;

-- =====================================================================
-- 3. PERSONAL data: staff full org + student(self) + parent(children)
-- =====================================================================
-- students -----------------------------------------------------------
SELECT public._reset_policies('students');
CREATE POLICY students_staff_all ON public.students FOR ALL
  USING (organization_id = current_user_org_id() AND public.is_staff_user())
  WITH CHECK (organization_id = current_user_org_id() AND public.is_staff_user());
CREATE POLICY students_self_read ON public.students FOR SELECT
  USING (id IN (SELECT student_id FROM public.my_linked_student_ids()));

-- student_enrollments ------------------------------------------------
SELECT public._reset_policies('student_enrollments');
CREATE POLICY enrollments_staff_all ON public.student_enrollments FOR ALL
  USING (organization_id = current_user_org_id() AND public.is_staff_user())
  WITH CHECK (organization_id = current_user_org_id() AND public.is_staff_user());
CREATE POLICY enrollments_self_read ON public.student_enrollments FOR SELECT
  USING (student_id IN (SELECT student_id FROM public.my_linked_student_ids()));

-- income_entries (fees/payments) -------------------------------------
SELECT public._reset_policies('income_entries');
CREATE POLICY income_staff_all ON public.income_entries FOR ALL
  USING (organization_id = current_user_org_id() AND public.is_staff_user())
  WITH CHECK (organization_id = current_user_org_id() AND public.is_staff_user());
CREATE POLICY income_self_read ON public.income_entries FOR SELECT
  USING (student_id IN (SELECT student_id FROM public.my_linked_student_ids()));

-- student_scores -----------------------------------------------------
SELECT public._reset_policies('student_scores');
CREATE POLICY scores_staff_all ON public.student_scores FOR ALL
  USING (organization_id = current_user_org_id() AND public.is_staff_user())
  WITH CHECK (organization_id = current_user_org_id() AND public.is_staff_user());
CREATE POLICY scores_self_read ON public.student_scores FOR SELECT
  USING (student_id IN (SELECT student_id FROM public.my_linked_student_ids()));

-- attendance_records -------------------------------------------------
SELECT public._reset_policies('attendance_records');
CREATE POLICY attendance_staff_all ON public.attendance_records FOR ALL
  USING (organization_id = current_user_org_id() AND public.is_staff_user())
  WITH CHECK (organization_id = current_user_org_id() AND public.is_staff_user());
CREATE POLICY attendance_self_read ON public.attendance_records FOR SELECT
  USING (student_id IN (SELECT student_id FROM public.my_linked_student_ids()));

-- exam_attempts ------------------------------------------------------
SELECT public._reset_policies('exam_attempts');
CREATE POLICY attempts_staff_all ON public.exam_attempts FOR ALL
  USING (organization_id = current_user_org_id() AND public.is_staff_user())
  WITH CHECK (organization_id = current_user_org_id() AND public.is_staff_user());
CREATE POLICY attempts_self_read ON public.exam_attempts FOR SELECT
  USING (student_id IN (SELECT student_id FROM public.my_linked_student_ids()));
-- A student may create/continue only their OWN attempts (belt-and-braces;
-- start_exam_attempt() is SECURITY DEFINER and the primary path).
CREATE POLICY attempts_self_write ON public.exam_attempts FOR INSERT
  WITH CHECK (student_id IN (SELECT student_id FROM public.my_linked_student_ids()));
CREATE POLICY attempts_self_update ON public.exam_attempts FOR UPDATE
  USING (student_id IN (SELECT student_id FROM public.my_linked_student_ids()));

-- exam_answers -------------------------------------------------------
SELECT public._reset_policies('exam_answers');
CREATE POLICY answers_staff_all ON public.exam_answers FOR ALL
  USING (organization_id = current_user_org_id() AND public.is_staff_user())
  WITH CHECK (organization_id = current_user_org_id() AND public.is_staff_user());
-- Student may read + write answers only for their OWN in-progress attempt.
CREATE POLICY answers_self_all ON public.exam_answers FOR ALL
  USING (
    attempt_id IN (
      SELECT ea.id FROM public.exam_attempts ea
      WHERE ea.student_id IN (SELECT student_id FROM public.my_linked_student_ids())
    )
  )
  WITH CHECK (
    attempt_id IN (
      SELECT ea.id FROM public.exam_attempts ea
      WHERE ea.student_id IN (SELECT student_id FROM public.my_linked_student_ids())
        AND ea.status = 'in_progress'
    )
  );

-- report_cards -------------------------------------------------------
SELECT public._reset_policies('report_cards');
CREATE POLICY report_cards_staff_all ON public.report_cards FOR ALL
  USING (organization_id = current_user_org_id() AND public.is_staff_user())
  WITH CHECK (organization_id = current_user_org_id() AND public.is_staff_user());
-- Students/parents see only their own, and only once published.
CREATE POLICY report_cards_self_read ON public.report_cards FOR SELECT
  USING (
    published = true
    AND student_id IN (SELECT student_id FROM public.my_linked_student_ids())
  );

-- report_card_subjects (child of report_cards) -----------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='report_card_subjects') THEN
    PERFORM public._reset_policies('report_card_subjects');
    -- staff: via parent org
    EXECUTE $p$
      CREATE POLICY rcs_staff_all ON public.report_card_subjects FOR ALL
      USING (report_card_id IN (
        SELECT id FROM public.report_cards
        WHERE organization_id = current_user_org_id() AND public.is_staff_user()))
      WITH CHECK (report_card_id IN (
        SELECT id FROM public.report_cards
        WHERE organization_id = current_user_org_id() AND public.is_staff_user()))
    $p$;
    EXECUTE $p$
      CREATE POLICY rcs_self_read ON public.report_card_subjects FOR SELECT
      USING (report_card_id IN (
        SELECT id FROM public.report_cards
        WHERE published = true
          AND student_id IN (SELECT student_id FROM public.my_linked_student_ids())))
    $p$;
  END IF;
END $$;

-- exams --------------------------------------------------------------
-- Exams carry no answers, but a student should still only see published
-- exams in their school (to list what they can take). Staff see all.
SELECT public._reset_policies('exams');
CREATE POLICY exams_staff_all ON public.exams FOR ALL
  USING (organization_id = current_user_org_id() AND public.is_staff_user())
  WITH CHECK (organization_id = current_user_org_id() AND public.is_staff_user());
CREATE POLICY exams_student_read ON public.exams FOR SELECT
  USING (
    status = 'published'
    AND organization_id IN (
      SELECT organization_id FROM public.students WHERE profile_id = auth.uid()
      UNION
      SELECT s.organization_id
      FROM public.students s
      WHERE s.id IN (SELECT student_id FROM public.my_linked_student_ids())
    )
  );

-- questions & exam_questions ----------------------------------------
-- Staff manage the whole bank. A student may read ONLY the questions of
-- an exam they actually have an attempt for — which keeps the exam
-- runner working (it opens an attempt, then reads that exam's questions)
-- without exposing the rest of the bank. NOTE: this still lets a student
-- see is_correct for their own active exam via devtools; the follow-up
-- is to serve questions through a sanitized RPC that strips answers.
SELECT public._reset_policies('questions');
CREATE POLICY questions_staff_all ON public.questions FOR ALL
  USING (organization_id = current_user_org_id() AND public.is_staff_user())
  WITH CHECK (organization_id = current_user_org_id() AND public.is_staff_user());
CREATE POLICY questions_student_read ON public.questions FOR SELECT
  USING (
    id IN (
      SELECT eq.question_id
      FROM public.exam_questions eq
      JOIN public.exam_attempts ea ON ea.exam_id = eq.exam_id
      WHERE ea.student_id IN (SELECT student_id FROM public.my_linked_student_ids())
    )
  );

SELECT public._reset_policies('exam_questions');
CREATE POLICY exam_questions_staff_all ON public.exam_questions FOR ALL
  USING (organization_id = current_user_org_id() AND public.is_staff_user())
  WITH CHECK (organization_id = current_user_org_id() AND public.is_staff_user());
CREATE POLICY exam_questions_student_read ON public.exam_questions FOR SELECT
  USING (
    exam_id IN (
      SELECT ea.exam_id FROM public.exam_attempts ea
      WHERE ea.student_id IN (SELECT student_id FROM public.my_linked_student_ids())
    )
  );

-- cbt_exam_assignments ----------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='cbt_exam_assignments') THEN
    PERFORM public._reset_policies('cbt_exam_assignments');
    EXECUTE $p$
      CREATE POLICY cea_staff_all ON public.cbt_exam_assignments FOR ALL
      USING (organization_id = current_user_org_id() AND public.is_staff_user())
      WITH CHECK (organization_id = current_user_org_id() AND public.is_staff_user())
    $p$;
    EXECUTE $p$
      CREATE POLICY cea_self_read ON public.cbt_exam_assignments FOR SELECT
      USING (student_id IN (SELECT student_id FROM public.my_linked_student_ids()))
    $p$;
  END IF;
END $$;

-- =====================================================================
-- 4. REFERENCE / CONFIG: any active member reads, only staff writes.
--    Non-sensitive (names, terms, periods, grade bands, announcements)
--    and required to render the student/parent portals.
-- =====================================================================
DO $$
DECLARE
  t text;
  ref_tables text[] := ARRAY[
    'classes','subjects','academic_years','periods',
    'attendance_statuses','grading_scales','timetable_entries','announcements'
  ];
BEGIN
  FOREACH t IN ARRAY ref_tables LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema='public' AND table_name=t) THEN CONTINUE; END IF;
    PERFORM public._reset_policies(t);
    -- read: any active member of the org
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR SELECT
      USING (organization_id = current_user_org_id())
    $f$, t || '_member_read', t);
    -- write: staff only (three explicit commands so USING/CHECK are correct)
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR INSERT
      WITH CHECK (organization_id = current_user_org_id() AND public.is_staff_user())
    $f$, t || '_staff_insert', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR UPDATE
      USING (organization_id = current_user_org_id() AND public.is_staff_user())
      WITH CHECK (organization_id = current_user_org_id() AND public.is_staff_user())
    $f$, t || '_staff_update', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR DELETE
      USING (organization_id = current_user_org_id() AND public.is_staff_user())
    $f$, t || '_staff_delete', t);
  END LOOP;
END $$;

-- fee_schedules: staff write; a student/parent may read (it is the
-- public price list, and the portal shows "what you owe" against it).
SELECT public._reset_policies('fee_schedules');
CREATE POLICY fees_member_read ON public.fee_schedules FOR SELECT
  USING (organization_id = current_user_org_id());
CREATE POLICY fees_staff_insert ON public.fee_schedules FOR INSERT
  WITH CHECK (organization_id = current_user_org_id() AND public.is_staff_user());
CREATE POLICY fees_staff_update ON public.fee_schedules FOR UPDATE
  USING (organization_id = current_user_org_id() AND public.is_staff_user())
  WITH CHECK (organization_id = current_user_org_id() AND public.is_staff_user());
CREATE POLICY fees_staff_delete ON public.fee_schedules FOR DELETE
  USING (organization_id = current_user_org_id() AND public.is_staff_user());

-- =====================================================================
-- 4b. profiles — the member directory must not be readable by
--     students/parents. Keep own-profile read for everyone (needed to
--     sign in and render the portal); restrict org-wide profile read to
--     staff. Other profiles policies (own_update, org_admin_update,
--     platform_admin_read, service_insert) from fix_profile_isolation
--     are left intact.
-- =====================================================================
DROP POLICY IF EXISTS "profiles_org_read" ON public.profiles;
CREATE POLICY "profiles_org_read" ON public.profiles FOR SELECT
  USING (
    public.is_staff_user()
    AND id IN (
      SELECT m.user_id FROM org_memberships m
      WHERE m.organization_id IN (
        SELECT m2.organization_id FROM org_memberships m2
        WHERE m2.user_id = auth.uid() AND m2.active = true
      )
    )
  );

-- =====================================================================
-- 4c. subscriptions — every member (incl. students) must read their own
--     org's module entitlements, because AuthContext.hasModule() depends
--     on it to render the portal. But scope it strictly to the caller's
--     org so it is not a cross-tenant read. Writes stay platform-admin
--     only (unchanged — handled elsewhere).
-- =====================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='subscriptions') THEN
    PERFORM public._reset_policies('subscriptions');
    -- Every active member reads their own org's entitlements.
    CREATE POLICY subscriptions_member_read ON public.subscriptions FOR SELECT
      USING (
        organization_id IN (
          SELECT m.organization_id FROM org_memberships m
          WHERE m.user_id = auth.uid() AND m.active = true
        )
      );
    -- Only platform admins may change entitlements (billing surface).
    CREATE POLICY subscriptions_platform_admin_all ON public.subscriptions FOR ALL
      USING (is_platform_admin())
      WITH CHECK (is_platform_admin());
  END IF;
END $$;

-- =====================================================================
-- 5. VERIFY — after running, sign in as a student and confirm they can
--    no longer read other students' rows. This query lists any tenant
--    policy that still grants blanket org access WITHOUT a staff gate
--    or a self-scope (should be limited to the reference/config +
--    fee_schedules + announcements read policies by design).
-- =====================================================================
SELECT tablename, policyname, cmd,
       CASE WHEN qual LIKE '%is_staff_user%' THEN 'staff-gated'
            WHEN qual LIKE '%my_linked_student_ids%' THEN 'self-scoped'
            WHEN qual LIKE '%current_user_org_id%' THEN 'ORG-WIDE (review)'
            ELSE 'other' END AS access_shape
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'students','student_enrollments','income_entries','expense_entries',
    'student_scores','attendance_records','exam_attempts','exam_answers',
    'report_cards','exams','questions','staff_members','vendors',
    'bank_transactions','fee_schedules','cbt_exam_assignments'
  )
ORDER BY tablename, cmd, policyname;
