-- ============================================================================
-- PHASE 1 — CRITICAL SECURITY FOUNDATION
-- ============================================================================
-- Run manually in Supabase SQL Editor AFTER every existing migration, including
-- 20260902180000_communication_module.sql and rls_finance_permission_scope.sql.
-- This is intentionally a final reconciliation migration: later migrations
-- must not add permissive policies after it without updating this file.
--
-- No data is deleted or changed. This migration replaces RLS policies,
-- adds authorization helpers/triggers, and wraps SECURITY DEFINER RPCs so
-- direct Supabase/API access is subject to the same role and tenant rules as
-- the UI.
-- ============================================================================

-- Fail closed if the foundational tenant/role helpers are not installed.
DO $$
DECLARE
  missing text[] := ARRAY[]::text[];
  required text[] := ARRAY[
    'lms_courses','lms_lessons','lms_enrollments','lms_lesson_progress',
    'lms_quizzes','lms_quiz_questions','lms_quiz_attempts','lms_quiz_answers',
    'lms_assignments','lms_submissions','lms_badges','lms_student_badges',
    'lms_discussions','lms_discussion_replies',
    'clinic_patient_records','clinic_visits','clinic_medications_inventory',
    'clinic_medications_dispensed','clinic_vaccinations','clinic_health_incidents',
    'payroll_components','payroll_staff_components','payroll_runs','payroll_payslips',
    'assets','asset_assignments','asset_maintenance','asset_disposals',
    'library_books','library_book_copies','library_loans','library_reservations',
    'hostel_houses','hostel_rooms','hostel_beds','hostel_allocations',
    'hostel_visitor_log','hostel_incidents',
    'transport_vehicles','transport_routes','transport_student_assignments',
    'procurement_requests','procurement_request_items','procurement_orders',
    'procurement_order_items','procurement_receipts',
    'inventory_items','stock_movements','departments',
    'teacher_assignments','parent_profiles','parent_student_links',
    'student_enrollments','students','staff_members','roles','org_memberships'
  ];
  t text;
BEGIN
  IF to_regprocedure('public.current_user_org_id()') IS NULL THEN missing := missing || 'current_user_org_id()'; END IF;
  IF to_regprocedure('public.is_platform_admin()') IS NULL THEN missing := missing || 'is_platform_admin()'; END IF;
  IF to_regprocedure('public.is_org_admin(uuid)') IS NULL THEN missing := missing || 'is_org_admin(uuid)'; END IF;
  IF to_regprocedure('public.my_effective_permissions()') IS NULL THEN missing := missing || 'my_effective_permissions()'; END IF;
  IF to_regprocedure('public.my_linked_student_ids()') IS NULL THEN missing := missing || 'my_linked_student_ids()'; END IF;
  FOREACH t IN ARRAY required LOOP
    IF to_regclass('public.' || t) IS NULL THEN missing := missing || t; END IF;
  END LOOP;
  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 1 security migration prerequisites missing: %', array_to_string(missing, ', ');
  END IF;
END $$;

-- The earlier migration defines this helper. Re-declare it here so this file
-- remains the final, explicit policy reset point and can be safely re-run.
CREATE OR REPLACE FUNCTION public._reset_policies(p_table text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r record;
BEGIN
  IF to_regclass('public.' || p_table) IS NULL THEN RETURN; END IF;
  FOR r IN SELECT policyname FROM pg_policies
           WHERE schemaname = 'public' AND tablename = p_table LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, p_table);
  END LOOP;
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', p_table);
END $$;

-- ---------------------------------------------------------------------------
-- Authorization primitives. These use the active organization membership;
-- client-supplied organization IDs are never trusted.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.phase1_active_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT m.role
  FROM public.org_memberships m
  WHERE m.user_id = auth.uid() AND m.active = true AND m.is_default = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.phase1_same_org(p_org uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p_org IS NOT NULL
     AND (p_org = public.current_user_org_id() OR public.is_platform_admin());
$$;

CREATE OR REPLACE FUNCTION public.phase1_has_any_role(p_roles text[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_platform_admin()
      OR EXISTS (
        SELECT 1 FROM public.org_memberships m
        WHERE m.user_id = auth.uid()
          AND m.active = true
          AND m.is_default = true
          AND m.role = ANY (p_roles)
      );
$$;

CREATE OR REPLACE FUNCTION public.phase1_has_permission(p_key text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_platform_admin()
      OR public.is_org_admin(public.current_user_org_id())
      OR COALESCE((public.my_effective_permissions() ->> p_key) = 'true', false);
$$;

CREATE OR REPLACE FUNCTION public.phase1_finance_access()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.phase1_has_any_role(ARRAY['owner','admin','bursar','accountant','developer'])
      OR public.phase1_has_permission('income')
      OR public.phase1_has_permission('expenses')
      OR public.phase1_has_permission('receipts')
      OR public.phase1_has_permission('reconciliation')
      OR public.phase1_has_permission('vendors')
      OR public.phase1_has_permission('sms_alerts')
      OR public.phase1_has_permission('student_finance')
      OR public.phase1_has_permission('finance_overview');
$$;

CREATE OR REPLACE FUNCTION public.has_finance_access()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.phase1_finance_access(); $$;

CREATE OR REPLACE FUNCTION public.phase1_operations_access()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.phase1_has_any_role(ARRAY['owner','admin','editor','staff','bursar','accountant','developer'])
      OR public.phase1_has_permission('inventory');
$$;

CREATE OR REPLACE FUNCTION public.phase1_hr_access()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.phase1_has_any_role(ARRAY['owner','admin','editor','staff','bursar','accountant','developer']);
$$;

CREATE OR REPLACE FUNCTION public.phase1_clinic_access()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.phase1_has_any_role(ARRAY['owner','admin','editor','staff','developer']);
$$;

CREATE OR REPLACE FUNCTION public.phase1_lms_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.phase1_has_any_role(ARRAY['owner','admin','editor','staff','developer']);
$$;

CREATE OR REPLACE FUNCTION public.phase1_own_student(p_student uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.phase1_active_role() = 'student'
     AND EXISTS (
       SELECT 1 FROM public.students s
       WHERE s.id = p_student
         AND s.organization_id = public.current_user_org_id()
         AND s.profile_id = auth.uid()
     );
$$;

CREATE OR REPLACE FUNCTION public.phase1_student_scope(p_student uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p_student IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.id = p_student
      AND s.organization_id = public.current_user_org_id()
      AND (
        s.profile_id = auth.uid()
        OR s.id IN (SELECT x.student_id FROM public.my_linked_student_ids() x)
        OR (
          public.phase1_active_role() = 'teacher'
          AND EXISTS (
            SELECT 1
            FROM public.teacher_assignments ta
            JOIN public.student_enrollments se
              ON se.class_id = ta.class_id
             AND se.student_id = s.id
             AND se.status = 'active'
            WHERE ta.user_id = auth.uid()
              AND ta.organization_id = public.current_user_org_id()
              AND ta.active = true
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.phase1_teacher_course_scope(p_course uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.phase1_lms_admin()
      OR (
        public.phase1_active_role() = 'teacher'
        AND EXISTS (
          SELECT 1
          FROM public.lms_courses c
          LEFT JOIN public.staff_members sm
            ON sm.id = c.teacher_staff_id
           AND sm.organization_id = public.current_user_org_id()
          WHERE c.id = p_course
            AND c.organization_id = public.current_user_org_id()
            AND (
              sm.user_id = auth.uid()
              OR EXISTS (
                SELECT 1 FROM public.teacher_assignments ta
                WHERE ta.user_id = auth.uid()
                  AND ta.organization_id = public.current_user_org_id()
                  AND ta.active = true
                  AND ta.class_id = c.class_id
                  AND (ta.subject_id IS NULL OR ta.subject_id = c.subject_id)
              )
            )
        )
      );
$$;

GRANT EXECUTE ON FUNCTION public.phase1_active_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.phase1_same_org(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.phase1_has_any_role(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.phase1_has_permission(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.phase1_finance_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_finance_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.phase1_operations_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.phase1_hr_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.phase1_clinic_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.phase1_lms_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.phase1_own_student(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.phase1_student_scope(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.phase1_teacher_course_scope(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Core tenant/RLS reconciliation.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Memberships are readable by the member or an administrator, but only
  -- organization administrators may change the roster. Switching the active
  -- organization is performed through the existing SECURITY DEFINER RPC.
  PERFORM public._reset_policies('org_memberships');
  CREATE POLICY phase1_memberships_read ON public.org_memberships FOR SELECT
    USING (user_id = auth.uid() OR public.is_org_admin(organization_id) OR public.is_platform_admin());
  CREATE POLICY phase1_memberships_insert ON public.org_memberships FOR INSERT
    WITH CHECK (public.is_org_admin(organization_id) OR public.is_platform_admin());
  CREATE POLICY phase1_memberships_update ON public.org_memberships FOR UPDATE
    USING (public.is_org_admin(organization_id) OR public.is_platform_admin())
    WITH CHECK (public.is_org_admin(organization_id) OR public.is_platform_admin());
  CREATE POLICY phase1_memberships_delete ON public.org_memberships FOR DELETE
    USING (public.is_org_admin(organization_id) OR public.is_platform_admin());

  PERFORM public._reset_policies('roles');
  CREATE POLICY phase1_roles_select ON public.roles FOR SELECT
    USING (public.phase1_same_org(organization_id) AND (public.is_org_admin(organization_id) OR name = public.phase1_active_role()));
  CREATE POLICY phase1_roles_insert ON public.roles FOR INSERT
    WITH CHECK (public.phase1_same_org(organization_id) AND public.is_org_admin(organization_id));
  CREATE POLICY phase1_roles_update ON public.roles FOR UPDATE
    USING (public.phase1_same_org(organization_id) AND public.is_org_admin(organization_id))
    WITH CHECK (public.phase1_same_org(organization_id) AND public.is_org_admin(organization_id));
  CREATE POLICY phase1_roles_delete ON public.roles FOR DELETE
    USING (public.phase1_same_org(organization_id) AND public.is_org_admin(organization_id));

  PERFORM public._reset_policies('teacher_assignments');
  CREATE POLICY phase1_teacher_assignments_admin_read ON public.teacher_assignments FOR SELECT
    USING (public.phase1_same_org(organization_id) AND public.phase1_hr_access());
  CREATE POLICY phase1_teacher_assignments_self_read ON public.teacher_assignments FOR SELECT
    USING (public.phase1_same_org(organization_id) AND user_id = auth.uid());
  CREATE POLICY phase1_teacher_assignments_admin_insert ON public.teacher_assignments FOR INSERT
    WITH CHECK (public.phase1_same_org(organization_id) AND public.is_org_admin(organization_id));
  CREATE POLICY phase1_teacher_assignments_admin_update ON public.teacher_assignments FOR UPDATE
    USING (public.phase1_same_org(organization_id) AND public.is_org_admin(organization_id))
    WITH CHECK (public.phase1_same_org(organization_id) AND public.is_org_admin(organization_id));
  CREATE POLICY phase1_teacher_assignments_admin_delete ON public.teacher_assignments FOR DELETE
    USING (public.phase1_same_org(organization_id) AND public.is_org_admin(organization_id));

  PERFORM public._reset_policies('parent_profiles');
  CREATE POLICY phase1_parent_profiles_staff_read ON public.parent_profiles FOR SELECT
    USING (public.phase1_same_org(organization_id) AND public.phase1_hr_access());
  CREATE POLICY phase1_parent_profiles_self_read ON public.parent_profiles FOR SELECT
    USING (public.phase1_same_org(organization_id) AND profile_id = auth.uid());
  CREATE POLICY phase1_parent_profiles_admin_insert ON public.parent_profiles FOR INSERT
    WITH CHECK (public.phase1_same_org(organization_id) AND public.is_org_admin(organization_id));
  CREATE POLICY phase1_parent_profiles_admin_update ON public.parent_profiles FOR UPDATE
    USING (public.phase1_same_org(organization_id) AND public.is_org_admin(organization_id))
    WITH CHECK (public.phase1_same_org(organization_id) AND public.is_org_admin(organization_id));
  CREATE POLICY phase1_parent_profiles_admin_delete ON public.parent_profiles FOR DELETE
    USING (public.phase1_same_org(organization_id) AND public.is_org_admin(organization_id));

  PERFORM public._reset_policies('parent_student_links');
  CREATE POLICY phase1_parent_links_staff_read ON public.parent_student_links FOR SELECT
    USING (public.phase1_same_org(organization_id) AND public.phase1_hr_access());
  CREATE POLICY phase1_parent_links_self_read ON public.parent_student_links FOR SELECT
    USING (public.phase1_same_org(organization_id) AND parent_id IN (
      SELECT pp.id FROM public.parent_profiles pp WHERE pp.profile_id = auth.uid()
    ));
  CREATE POLICY phase1_parent_links_admin_insert ON public.parent_student_links FOR INSERT
    WITH CHECK (public.phase1_same_org(organization_id) AND public.is_org_admin(organization_id));
  CREATE POLICY phase1_parent_links_admin_update ON public.parent_student_links FOR UPDATE
    USING (public.phase1_same_org(organization_id) AND public.is_org_admin(organization_id))
    WITH CHECK (public.phase1_same_org(organization_id) AND public.is_org_admin(organization_id));
  CREATE POLICY phase1_parent_links_admin_delete ON public.parent_student_links FOR DELETE
    USING (public.phase1_same_org(organization_id) AND public.is_org_admin(organization_id));
END $$;

-- Personal/academic tables: staff/admins have organization access; teachers
-- are restricted to assigned classes; students/parents are self/child read-only.
DO $$
BEGIN
  PERFORM public._reset_policies('students');
  CREATE POLICY phase1_students_staff_read ON public.students FOR SELECT
    USING (public.phase1_same_org(organization_id) AND public.phase1_hr_access());
  CREATE POLICY phase1_students_teacher_read ON public.students FOR SELECT
    USING (public.phase1_same_org(organization_id) AND public.phase1_active_role() = 'teacher'
      AND public.phase1_student_scope(id));
  CREATE POLICY phase1_students_self_read ON public.students FOR SELECT
    USING (public.phase1_same_org(organization_id) AND id IN (SELECT x.student_id FROM public.my_linked_student_ids() x));
  CREATE POLICY phase1_students_staff_insert ON public.students FOR INSERT
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_hr_access());
  CREATE POLICY phase1_students_staff_update ON public.students FOR UPDATE
    USING (public.phase1_same_org(organization_id) AND public.phase1_hr_access())
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_hr_access());
  CREATE POLICY phase1_students_staff_delete ON public.students FOR DELETE
    USING (public.phase1_same_org(organization_id) AND public.is_org_admin(organization_id));

  PERFORM public._reset_policies('student_enrollments');
  CREATE POLICY phase1_enrollments_staff_read ON public.student_enrollments FOR SELECT
    USING (public.phase1_same_org((SELECT s.organization_id FROM public.students s WHERE s.id = student_id))
      AND public.phase1_hr_access());
  CREATE POLICY phase1_enrollments_teacher_read ON public.student_enrollments FOR SELECT
    USING (public.phase1_active_role() = 'teacher' AND public.phase1_student_scope(student_id));
  CREATE POLICY phase1_enrollments_self_read ON public.student_enrollments FOR SELECT
    USING (student_id IN (SELECT x.student_id FROM public.my_linked_student_ids()));
  CREATE POLICY phase1_enrollments_staff_insert ON public.student_enrollments FOR INSERT
    WITH CHECK (public.phase1_hr_access() AND student_id IN (SELECT s.id FROM public.students s WHERE public.phase1_same_org(s.organization_id)));
  CREATE POLICY phase1_enrollments_staff_update ON public.student_enrollments FOR UPDATE
    USING (public.phase1_hr_access() AND student_id IN (SELECT s.id FROM public.students s WHERE public.phase1_same_org(s.organization_id)))
    WITH CHECK (public.phase1_hr_access() AND student_id IN (SELECT s.id FROM public.students s WHERE public.phase1_same_org(s.organization_id)));
  CREATE POLICY phase1_enrollments_staff_delete ON public.student_enrollments FOR DELETE
    USING (public.phase1_hr_access() AND student_id IN (SELECT s.id FROM public.students s WHERE public.phase1_same_org(s.organization_id)));

  PERFORM public._reset_policies('student_scores');
  CREATE POLICY phase1_scores_staff_all ON public.student_scores FOR ALL
    USING (public.phase1_same_org(organization_id) AND public.phase1_hr_access())
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_hr_access());
  CREATE POLICY phase1_scores_teacher_read ON public.student_scores FOR SELECT
    USING (public.phase1_same_org(organization_id) AND public.phase1_active_role() = 'teacher' AND public.phase1_student_scope(student_id));
  CREATE POLICY phase1_scores_teacher_write ON public.student_scores FOR INSERT
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_active_role() = 'teacher' AND public.phase1_student_scope(student_id));
  CREATE POLICY phase1_scores_teacher_update ON public.student_scores FOR UPDATE
    USING (public.phase1_same_org(organization_id) AND public.phase1_active_role() = 'teacher' AND public.phase1_student_scope(student_id))
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_active_role() = 'teacher' AND public.phase1_student_scope(student_id));
  CREATE POLICY phase1_scores_self_read ON public.student_scores FOR SELECT
    USING (public.phase1_same_org(organization_id) AND student_id IN (SELECT x.student_id FROM public.my_linked_student_ids()));

  PERFORM public._reset_policies('attendance_records');
  CREATE POLICY phase1_attendance_staff_all ON public.attendance_records FOR ALL
    USING (public.phase1_same_org(organization_id) AND public.phase1_hr_access())
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_hr_access());
  CREATE POLICY phase1_attendance_teacher_read ON public.attendance_records FOR SELECT
    USING (public.phase1_same_org(organization_id) AND public.phase1_active_role() = 'teacher' AND public.phase1_student_scope(student_id));
  CREATE POLICY phase1_attendance_teacher_insert ON public.attendance_records FOR INSERT
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_active_role() = 'teacher' AND public.phase1_student_scope(student_id));
  CREATE POLICY phase1_attendance_teacher_update ON public.attendance_records FOR UPDATE
    USING (public.phase1_same_org(organization_id) AND public.phase1_active_role() = 'teacher' AND public.phase1_student_scope(student_id))
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_active_role() = 'teacher' AND public.phase1_student_scope(student_id));
  CREATE POLICY phase1_attendance_self_read ON public.attendance_records FOR SELECT
    USING (public.phase1_same_org(organization_id) AND student_id IN (SELECT x.student_id FROM public.my_linked_student_ids()));
END $$;

-- Finance and payroll: finance permission is the source of truth. A parent or
-- student may read only linked payment rows; nobody else sees finance data.
DO $$
BEGIN
  PERFORM public._reset_policies('income_entries');
  CREATE POLICY phase1_income_finance_all ON public.income_entries FOR ALL
    USING (public.phase1_same_org(organization_id) AND public.phase1_finance_access())
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_finance_access());
  CREATE POLICY phase1_income_self_read ON public.income_entries FOR SELECT
    USING (public.phase1_same_org(organization_id) AND student_id IN (SELECT x.student_id FROM public.my_linked_student_ids()));

  PERFORM public._reset_policies('expense_entries');
  CREATE POLICY phase1_expense_finance_all ON public.expense_entries FOR ALL
    USING (public.phase1_same_org(organization_id) AND public.phase1_finance_access())
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_finance_access());
  PERFORM public._reset_policies('vendors');
  CREATE POLICY phase1_vendors_finance_all ON public.vendors FOR ALL
    USING (public.phase1_same_org(organization_id) AND public.phase1_finance_access())
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_finance_access());
  PERFORM public._reset_policies('bank_transactions');
  CREATE POLICY phase1_bank_finance_all ON public.bank_transactions FOR ALL
    USING (public.phase1_same_org(organization_id) AND public.phase1_finance_access())
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_finance_access());
  PERFORM public._reset_policies('sms_inbox');
  CREATE POLICY phase1_sms_finance_all ON public.sms_inbox FOR ALL
    USING (public.phase1_same_org(organization_id) AND public.phase1_finance_access())
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_finance_access());
  PERFORM public._reset_policies('fee_schedules');
  CREATE POLICY phase1_fees_member_read ON public.fee_schedules FOR SELECT
    USING (public.phase1_same_org(organization_id));
  CREATE POLICY phase1_fees_finance_insert ON public.fee_schedules FOR INSERT
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_finance_access());
  CREATE POLICY phase1_fees_finance_update ON public.fee_schedules FOR UPDATE
    USING (public.phase1_same_org(organization_id) AND public.phase1_finance_access())
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_finance_access());
  CREATE POLICY phase1_fees_finance_delete ON public.fee_schedules FOR DELETE
    USING (public.phase1_same_org(organization_id) AND public.phase1_finance_access());

  FOREACH t IN ARRAY ARRAY['payroll_components','payroll_staff_components','payroll_runs','payroll_payslips'] LOOP
    PERFORM public._reset_policies(t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (public.phase1_same_org(organization_id) AND public.phase1_finance_access())', 'phase1_' || t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_finance_access())', 'phase1_' || t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (public.phase1_same_org(organization_id) AND public.phase1_finance_access()) WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_finance_access())', 'phase1_' || t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE USING (public.phase1_same_org(organization_id) AND public.phase1_finance_access())', 'phase1_' || t || '_delete', t);
  END LOOP;
END $$;

-- HR data contains salary and bank-account fields. Only organization HR/
-- finance administrators can read or change it; a normal user can read their
-- own staff row, which is needed for the profile display.
DO $$
BEGIN
  PERFORM public._reset_policies('staff_members');
  CREATE POLICY phase1_staff_org_read ON public.staff_members FOR SELECT
    USING (public.phase1_same_org(organization_id) AND public.phase1_finance_access());
  CREATE POLICY phase1_staff_self_read ON public.staff_members FOR SELECT
    USING (public.phase1_same_org(organization_id) AND user_id = auth.uid());
  CREATE POLICY phase1_staff_admin_insert ON public.staff_members FOR INSERT
    WITH CHECK (public.phase1_same_org(organization_id) AND public.is_org_admin(organization_id));
  CREATE POLICY phase1_staff_admin_update ON public.staff_members FOR UPDATE
    USING (public.phase1_same_org(organization_id) AND public.is_org_admin(organization_id))
    WITH CHECK (public.phase1_same_org(organization_id) AND public.is_org_admin(organization_id));
  CREATE POLICY phase1_staff_admin_delete ON public.staff_members FOR DELETE
    USING (public.phase1_same_org(organization_id) AND public.is_org_admin(organization_id));
END $$;

-- ---------------------------------------------------------------------------
-- LMS policies. Course-authoring access is scoped to admins/editors/staff or a
-- teacher's assigned course. Students/parents receive only enrolled/linked
-- reads, and student progress writes are self-scoped.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM public._reset_policies('lms_courses');
  CREATE POLICY phase1_lms_courses_admin_all ON public.lms_courses FOR ALL
    USING (public.phase1_same_org(organization_id) AND public.phase1_lms_admin())
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_lms_admin());
  CREATE POLICY phase1_lms_courses_teacher_read ON public.lms_courses FOR SELECT
    USING (public.phase1_same_org(organization_id) AND public.phase1_teacher_course_scope(id));
  CREATE POLICY phase1_lms_courses_student_read ON public.lms_courses FOR SELECT
    USING (public.phase1_same_org(organization_id) AND status = 'published' AND EXISTS (
      SELECT 1 FROM public.lms_enrollments e
      WHERE e.course_id = id AND e.status IN ('active','completed')
        AND e.student_id IN (SELECT x.student_id FROM public.my_linked_student_ids())
    ));

  PERFORM public._reset_policies('lms_lessons');
  CREATE POLICY phase1_lms_lessons_admin_all ON public.lms_lessons FOR ALL
    USING (public.phase1_same_org(organization_id) AND public.phase1_lms_admin())
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_lms_admin());
  CREATE POLICY phase1_lms_lessons_teacher_all ON public.lms_lessons FOR ALL
    USING (public.phase1_same_org(organization_id) AND public.phase1_teacher_course_scope(course_id))
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_teacher_course_scope(course_id));
  CREATE POLICY phase1_lms_lessons_student_read ON public.lms_lessons FOR SELECT
    USING (public.phase1_same_org(organization_id) AND status = 'published' AND EXISTS (
      SELECT 1 FROM public.lms_enrollments e JOIN public.lms_courses c ON c.id = e.course_id
      WHERE e.course_id = course_id AND e.status IN ('active','completed')
        AND c.status = 'published'
        AND e.student_id IN (SELECT x.student_id FROM public.my_linked_student_ids())
    ));

  PERFORM public._reset_policies('lms_quizzes');
  CREATE POLICY phase1_lms_quizzes_admin_all ON public.lms_quizzes FOR ALL
    USING (public.phase1_same_org(organization_id) AND public.phase1_lms_admin())
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_lms_admin());
  CREATE POLICY phase1_lms_quizzes_teacher_all ON public.lms_quizzes FOR ALL
    USING (public.phase1_same_org(organization_id) AND public.phase1_teacher_course_scope((SELECT l.course_id FROM public.lms_lessons l WHERE l.id = lesson_id)))
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_teacher_course_scope((SELECT l.course_id FROM public.lms_lessons l WHERE l.id = lesson_id)));
  CREATE POLICY phase1_lms_quizzes_student_read ON public.lms_quizzes FOR SELECT
    USING (public.phase1_same_org(organization_id) AND EXISTS (
      SELECT 1 FROM public.lms_lessons l JOIN public.lms_enrollments e ON e.course_id = l.course_id
      WHERE l.id = lesson_id AND l.status = 'published' AND e.status IN ('active','completed')
        AND e.student_id IN (SELECT x.student_id FROM public.my_linked_student_ids())
    ));

  -- Question options include answer keys, so students never read this table
  -- directly. They use phase1_lms_get_quiz_questions(), which strips keys.
  PERFORM public._reset_policies('lms_quiz_questions');
  CREATE POLICY phase1_lms_quizq_admin_all ON public.lms_quiz_questions FOR ALL
    USING (public.phase1_same_org(organization_id) AND public.phase1_lms_admin())
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_lms_admin());
  CREATE POLICY phase1_lms_quizq_teacher_all ON public.lms_quiz_questions FOR ALL
    USING (public.phase1_same_org(organization_id) AND public.phase1_teacher_course_scope((SELECT l.course_id FROM public.lms_lessons l JOIN public.lms_quizzes q ON q.lesson_id = l.id JOIN public.lms_quiz_questions x ON x.quiz_id = q.id WHERE x.id = id)))
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_teacher_course_scope((SELECT l.course_id FROM public.lms_lessons l JOIN public.lms_quizzes q ON q.lesson_id = l.id JOIN public.lms_quiz_questions x ON x.quiz_id = q.id WHERE x.id = id)));

  PERFORM public._reset_policies('lms_assignments');
  CREATE POLICY phase1_lms_assignments_admin_all ON public.lms_assignments FOR ALL
    USING (public.phase1_same_org(organization_id) AND public.phase1_lms_admin())
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_lms_admin());
  CREATE POLICY phase1_lms_assignments_teacher_all ON public.lms_assignments FOR ALL
    USING (public.phase1_same_org(organization_id) AND public.phase1_teacher_course_scope((SELECT l.course_id FROM public.lms_lessons l WHERE l.id = lesson_id)))
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_teacher_course_scope((SELECT l.course_id FROM public.lms_lessons l WHERE l.id = lesson_id)));
  CREATE POLICY phase1_lms_assignments_student_read ON public.lms_assignments FOR SELECT
    USING (public.phase1_same_org(organization_id) AND EXISTS (
      SELECT 1 FROM public.lms_lessons l JOIN public.lms_enrollments e ON e.course_id = l.course_id
      WHERE l.id = lesson_id AND e.status IN ('active','completed')
        AND e.student_id IN (SELECT x.student_id FROM public.my_linked_student_ids())
    ));

  PERFORM public._reset_policies('lms_badges');
  CREATE POLICY phase1_lms_badges_staff_all ON public.lms_badges FOR ALL
    USING (public.phase1_same_org(organization_id) AND public.phase1_lms_admin())
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_lms_admin());
  CREATE POLICY phase1_lms_badges_member_read ON public.lms_badges FOR SELECT
    USING (public.phase1_same_org(organization_id));

  PERFORM public._reset_policies('lms_enrollments');
  CREATE POLICY phase1_lms_enrollments_staff_all ON public.lms_enrollments FOR ALL
    USING (public.phase1_same_org(organization_id) AND public.phase1_teacher_course_scope(course_id))
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_teacher_course_scope(course_id));
  CREATE POLICY phase1_lms_enrollments_self_read ON public.lms_enrollments FOR SELECT
    USING (public.phase1_same_org(organization_id) AND student_id IN (SELECT x.student_id FROM public.my_linked_student_ids()));
  CREATE POLICY phase1_lms_enrollments_self_insert ON public.lms_enrollments FOR INSERT
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_own_student(student_id)
      AND EXISTS (SELECT 1 FROM public.lms_courses c WHERE c.id = course_id AND c.organization_id = organization_id AND c.status = 'published'));

  PERFORM public._reset_policies('lms_lesson_progress');
  CREATE POLICY phase1_lms_progress_staff_all ON public.lms_lesson_progress FOR ALL
    USING (public.phase1_same_org(organization_id) AND public.phase1_teacher_course_scope((SELECT l.course_id FROM public.lms_lessons l WHERE l.id = lesson_id)))
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_teacher_course_scope((SELECT l.course_id FROM public.lms_lessons l WHERE l.id = lesson_id)));
  CREATE POLICY phase1_lms_progress_self_read ON public.lms_lesson_progress FOR SELECT
    USING (public.phase1_same_org(organization_id) AND student_id IN (SELECT x.student_id FROM public.my_linked_student_ids()));
  CREATE POLICY phase1_lms_progress_self_insert ON public.lms_lesson_progress FOR INSERT
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_own_student(student_id));
  CREATE POLICY phase1_lms_progress_self_update ON public.lms_lesson_progress FOR UPDATE
    USING (public.phase1_same_org(organization_id) AND public.phase1_own_student(student_id))
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_own_student(student_id));

  PERFORM public._reset_policies('lms_quiz_attempts');
  CREATE POLICY phase1_lms_attempts_staff_all ON public.lms_quiz_attempts FOR ALL
    USING (public.phase1_same_org(organization_id) AND public.phase1_teacher_course_scope((SELECT l.course_id FROM public.lms_lessons l JOIN public.lms_quizzes q ON q.lesson_id = l.id WHERE q.id = quiz_id)))
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_teacher_course_scope((SELECT l.course_id FROM public.lms_lessons l JOIN public.lms_quizzes q ON q.lesson_id = l.id WHERE q.id = quiz_id)));
  CREATE POLICY phase1_lms_attempts_self_read ON public.lms_quiz_attempts FOR SELECT
    USING (public.phase1_same_org(organization_id) AND student_id IN (SELECT x.student_id FROM public.my_linked_student_ids()));
  CREATE POLICY phase1_lms_attempts_self_insert ON public.lms_quiz_attempts FOR INSERT
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_own_student(student_id));
  CREATE POLICY phase1_lms_attempts_self_update ON public.lms_quiz_attempts FOR UPDATE
    USING (public.phase1_same_org(organization_id) AND public.phase1_own_student(student_id))
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_own_student(student_id));

  PERFORM public._reset_policies('lms_quiz_answers');
  CREATE POLICY phase1_lms_answers_staff_all ON public.lms_quiz_answers FOR ALL
    USING (public.phase1_same_org(organization_id) AND public.phase1_teacher_course_scope((SELECT l.course_id FROM public.lms_lessons l JOIN public.lms_quizzes q ON q.lesson_id = l.id JOIN public.lms_quiz_attempts a ON a.quiz_id = q.id WHERE a.id = attempt_id)))
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_teacher_course_scope((SELECT l.course_id FROM public.lms_lessons l JOIN public.lms_quizzes q ON q.lesson_id = l.id JOIN public.lms_quiz_attempts a ON a.quiz_id = q.id WHERE a.id = attempt_id)));
  CREATE POLICY phase1_lms_answers_self_read ON public.lms_quiz_answers FOR SELECT
    USING (public.phase1_same_org(organization_id) AND EXISTS (SELECT 1 FROM public.lms_quiz_attempts a WHERE a.id = attempt_id AND public.phase1_own_student(a.student_id)));
  CREATE POLICY phase1_lms_answers_self_insert ON public.lms_quiz_answers FOR INSERT
    WITH CHECK (public.phase1_same_org(organization_id) AND EXISTS (SELECT 1 FROM public.lms_quiz_attempts a WHERE a.id = attempt_id AND public.phase1_own_student(a.student_id) AND a.submitted_at IS NULL));

  PERFORM public._reset_policies('lms_submissions');
  CREATE POLICY phase1_lms_submissions_staff_all ON public.lms_submissions FOR ALL
    USING (public.phase1_same_org(organization_id) AND public.phase1_teacher_course_scope((SELECT l.course_id FROM public.lms_lessons l JOIN public.lms_assignments a ON a.lesson_id = l.id WHERE a.id = assignment_id)))
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_teacher_course_scope((SELECT l.course_id FROM public.lms_lessons l JOIN public.lms_assignments a ON a.lesson_id = l.id WHERE a.id = assignment_id)));
  CREATE POLICY phase1_lms_submissions_self_read ON public.lms_submissions FOR SELECT
    USING (public.phase1_same_org(organization_id) AND student_id IN (SELECT x.student_id FROM public.my_linked_student_ids()));
  CREATE POLICY phase1_lms_submissions_self_insert ON public.lms_submissions FOR INSERT
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_own_student(student_id));

  PERFORM public._reset_policies('lms_student_badges');
  CREATE POLICY phase1_lms_studentbadges_staff_all ON public.lms_student_badges FOR ALL
    USING (public.phase1_same_org(organization_id) AND public.phase1_lms_admin())
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_lms_admin());
  CREATE POLICY phase1_lms_studentbadges_self_read ON public.lms_student_badges FOR SELECT
    USING (public.phase1_same_org(organization_id) AND student_id IN (SELECT x.student_id FROM public.my_linked_student_ids()));

  PERFORM public._reset_policies('lms_discussions');
  CREATE POLICY phase1_lms_discussions_staff_all ON public.lms_discussions FOR ALL
    USING (public.phase1_same_org(organization_id) AND public.phase1_teacher_course_scope((SELECT l.course_id FROM public.lms_lessons l WHERE l.id = lesson_id)))
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_teacher_course_scope((SELECT l.course_id FROM public.lms_lessons l WHERE l.id = lesson_id)));
  CREATE POLICY phase1_lms_discussions_student_read ON public.lms_discussions FOR SELECT
    USING (public.phase1_same_org(organization_id) AND student_id IN (SELECT x.student_id FROM public.my_linked_student_ids()));
  CREATE POLICY phase1_lms_discussions_student_insert ON public.lms_discussions FOR INSERT
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_own_student(student_id));

  PERFORM public._reset_policies('lms_discussion_replies');
  CREATE POLICY phase1_lms_replies_staff_all ON public.lms_discussion_replies FOR ALL
    USING (public.phase1_same_org(organization_id) AND public.phase1_teacher_course_scope((SELECT l.course_id FROM public.lms_lessons l JOIN public.lms_discussions d ON d.lesson_id = l.id WHERE d.id = discussion_id)))
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_teacher_course_scope((SELECT l.course_id FROM public.lms_lessons l JOIN public.lms_discussions d ON d.lesson_id = l.id WHERE d.id = discussion_id)));
  CREATE POLICY phase1_lms_replies_student_read ON public.lms_discussion_replies FOR SELECT
    USING (public.phase1_same_org(organization_id) AND student_id IN (SELECT x.student_id FROM public.my_linked_student_ids()));
  CREATE POLICY phase1_lms_replies_student_insert ON public.lms_discussion_replies FOR INSERT
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_own_student(student_id));
END $$;

-- ---------------------------------------------------------------------------
-- Clinic/medical records: authorized clinic staff manage; students and parents
-- can read only their own/linked student records. Medication inventory and
-- dispensing logs remain clinic-staff-only.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM public._reset_policies('clinic_patient_records');
  CREATE POLICY phase1_clinic_patients_staff_all ON public.clinic_patient_records FOR ALL
    USING (public.phase1_same_org(organization_id) AND public.phase1_clinic_access())
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_clinic_access());
  CREATE POLICY phase1_clinic_patients_student_read ON public.clinic_patient_records FOR SELECT
    USING (public.phase1_same_org(organization_id) AND student_id IN (SELECT x.student_id FROM public.my_linked_student_ids()));
  CREATE POLICY phase1_clinic_patients_staffself_read ON public.clinic_patient_records FOR SELECT
    USING (public.phase1_same_org(organization_id) AND staff_id IN (SELECT sm.id FROM public.staff_members sm WHERE sm.user_id = auth.uid()));

  PERFORM public._reset_policies('clinic_visits');
  CREATE POLICY phase1_clinic_visits_staff_all ON public.clinic_visits FOR ALL
    USING (public.phase1_same_org(organization_id) AND public.phase1_clinic_access())
    WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_clinic_access());
  CREATE POLICY phase1_clinic_visits_student_read ON public.clinic_visits FOR SELECT
    USING (public.phase1_same_org(organization_id) AND student_id IN (SELECT x.student_id FROM public.my_linked_student_ids()));
  CREATE POLICY phase1_clinic_visits_staffself_read ON public.clinic_visits FOR SELECT
    USING (public.phase1_same_org(organization_id) AND staff_id IN (SELECT sm.id FROM public.staff_members sm WHERE sm.user_id = auth.uid()));

  FOREACH t IN ARRAY ARRAY['clinic_medications_inventory','clinic_medications_dispensed'] LOOP
    PERFORM public._reset_policies(t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (public.phase1_same_org(organization_id) AND public.phase1_clinic_access())', 'phase1_' || t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_clinic_access())', 'phase1_' || t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (public.phase1_same_org(organization_id) AND public.phase1_clinic_access()) WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_clinic_access())', 'phase1_' || t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE USING (public.phase1_same_org(organization_id) AND public.phase1_clinic_access())', 'phase1_' || t || '_delete', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['clinic_vaccinations','clinic_health_incidents'] LOOP
    PERFORM public._reset_policies(t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (public.phase1_same_org(organization_id) AND public.phase1_clinic_access()) WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_clinic_access())', 'phase1_' || t || '_staff_all', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (public.phase1_same_org(organization_id) AND student_id IN (SELECT x.student_id FROM public.my_linked_student_ids()))', 'phase1_' || t || '_student_read', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Operations modules: staff/admin operations access only. Student/parent/
-- teacher roles cannot read or mutate operational inventory, assets, hostel,
-- transport, library, or procurement data directly.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'assets','asset_assignments','asset_maintenance','asset_disposals',
    'library_books','library_book_copies','library_loans','library_reservations',
    'hostel_houses','hostel_rooms','hostel_beds','hostel_allocations',
    'hostel_visitor_log','hostel_incidents',
    'transport_vehicles','transport_routes','transport_student_assignments',
    'procurement_requests','procurement_request_items','procurement_orders',
    'procurement_order_items','procurement_receipts',
    'inventory_items','stock_movements','departments'
  ] LOOP
    PERFORM public._reset_policies(t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (public.phase1_same_org(organization_id) AND public.phase1_operations_access())', 'phase1_' || t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_operations_access())', 'phase1_' || t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (public.phase1_same_org(organization_id) AND public.phase1_operations_access()) WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_operations_access())', 'phase1_' || t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE USING (public.phase1_same_org(organization_id) AND public.phase1_operations_access())', 'phase1_' || t || '_delete', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Database trigger guard. SECURITY DEFINER RPCs bypass RLS, so sensitive
-- writes also pass through this caller-aware trigger. Service-role jobs remain
-- allowed; authenticated callers must satisfy the same role/ownership rules.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.phase1_sensitive_write_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_student uuid;
  v_course uuid;
BEGIN
  IF auth.role() IN ('service_role', 'supabase_admin') THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_TABLE_NAME = 'student_enrollments' THEN
    SELECT s.organization_id INTO v_org
    FROM public.students s
    WHERE s.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.student_id ELSE NEW.student_id END;
  ELSE
    v_org := CASE WHEN TG_OP = 'DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
  END IF;
  IF NOT public.phase1_same_org(v_org) THEN RAISE EXCEPTION 'organization boundary violation'; END IF;

  IF TG_TABLE_NAME IN ('students','student_enrollments') THEN
    IF NOT public.phase1_hr_access() THEN RAISE EXCEPTION 'student administration authorization required'; END IF;
  ELSIF TG_TABLE_NAME IN ('student_scores','attendance_records') THEN
    IF NOT (public.phase1_hr_access()
      OR (public.phase1_active_role() = 'teacher' AND EXISTS (
        SELECT 1 FROM public.teacher_assignments ta
        WHERE ta.user_id = auth.uid() AND ta.organization_id = v_org AND ta.active = true
          AND ta.class_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.class_id ELSE NEW.class_id END
          AND (ta.subject_id IS NULL OR ta.subject_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.subject_id ELSE NEW.subject_id END)
      ))) THEN RAISE EXCEPTION 'academic authorization required'; END IF;
  ELSIF TG_TABLE_NAME IN ('expense_entries','income_entries','vendors','bank_transactions','sms_inbox',
                       'payroll_components','payroll_staff_components','payroll_runs','payroll_payslips') THEN
    IF NOT public.phase1_finance_access() THEN RAISE EXCEPTION 'finance permission required'; END IF;
  ELSIF TG_TABLE_NAME = 'staff_members' THEN
    IF NOT public.is_org_admin(v_org) THEN RAISE EXCEPTION 'organization administrator required'; END IF;
  ELSIF TG_TABLE_NAME IN ('roles','org_memberships','teacher_assignments','parent_profiles','parent_student_links') THEN
    IF NOT public.is_org_admin(v_org) THEN RAISE EXCEPTION 'organization administrator required'; END IF;
  ELSIF TG_TABLE_NAME IN ('clinic_patient_records','clinic_visits','clinic_medications_inventory','clinic_medications_dispensed','clinic_vaccinations','clinic_health_incidents') THEN
    IF NOT public.phase1_clinic_access() THEN RAISE EXCEPTION 'clinic authorization required'; END IF;
  ELSIF TG_TABLE_NAME IN ('assets','asset_assignments','asset_maintenance','asset_disposals',
                          'library_books','library_book_copies','library_loans','library_reservations',
                          'hostel_houses','hostel_rooms','hostel_beds','hostel_allocations','hostel_visitor_log','hostel_incidents',
                          'transport_vehicles','transport_routes','transport_student_assignments',
                          'procurement_requests','procurement_request_items','procurement_orders','procurement_order_items','procurement_receipts',
                          'inventory_items','stock_movements','departments') THEN
    IF NOT public.phase1_operations_access() THEN RAISE EXCEPTION 'operations authorization required'; END IF;
  ELSIF TG_TABLE_NAME LIKE 'lms_%' THEN
    IF TG_TABLE_NAME IN ('lms_lesson_progress','lms_quiz_attempts','lms_submissions','lms_student_badges') THEN
      v_student := CASE WHEN TG_OP = 'DELETE' THEN OLD.student_id ELSE NEW.student_id END;
      IF NOT (public.phase1_lms_admin() OR public.phase1_teacher_course_scope(
        CASE
          WHEN TG_TABLE_NAME = 'lms_lesson_progress' THEN (SELECT l.course_id FROM public.lms_lessons l WHERE l.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.lesson_id ELSE NEW.lesson_id END)
          WHEN TG_TABLE_NAME = 'lms_quiz_attempts' THEN (SELECT l.course_id FROM public.lms_lessons l JOIN public.lms_quizzes q ON q.lesson_id = l.id WHERE q.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.quiz_id ELSE NEW.quiz_id END)
          WHEN TG_TABLE_NAME = 'lms_submissions' THEN (SELECT l.course_id FROM public.lms_lessons l JOIN public.lms_assignments a ON a.lesson_id = l.id WHERE a.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.assignment_id ELSE NEW.assignment_id END)
          ELSE NULL
        END
      ) OR public.phase1_own_student(v_student)) THEN RAISE EXCEPTION 'LMS ownership or teacher scope required'; END IF;
    ELSIF TG_TABLE_NAME = 'lms_quiz_answers' THEN
      IF NOT (public.phase1_lms_admin() OR EXISTS (
        SELECT 1 FROM public.lms_quiz_attempts a
        WHERE a.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.attempt_id ELSE NEW.attempt_id END
          AND public.phase1_own_student(a.student_id) AND a.submitted_at IS NULL
      )) THEN RAISE EXCEPTION 'LMS answer ownership required'; END IF;
    ELSIF TG_TABLE_NAME = 'lms_enrollments' THEN
      v_student := CASE WHEN TG_OP = 'DELETE' THEN OLD.student_id ELSE NEW.student_id END;
      IF NOT (public.phase1_lms_admin() OR public.phase1_teacher_course_scope(CASE WHEN TG_OP = 'DELETE' THEN OLD.course_id ELSE NEW.course_id END)
        OR (TG_OP = 'INSERT' AND public.phase1_own_student(v_student))) THEN RAISE EXCEPTION 'LMS enrollment authorization required'; END IF;
    ELSIF NOT (public.phase1_lms_admin() OR public.phase1_teacher_course_scope(
      CASE
        WHEN TG_TABLE_NAME = 'lms_courses' THEN CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END
        WHEN TG_TABLE_NAME = 'lms_lessons' THEN (SELECT l.course_id FROM public.lms_lessons l WHERE l.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END)
        WHEN TG_TABLE_NAME = 'lms_quizzes' THEN (SELECT l.course_id FROM public.lms_lessons l JOIN public.lms_quizzes q ON q.lesson_id = l.id WHERE q.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END)
        ELSE NULL
      END
    )) THEN RAISE EXCEPTION 'LMS teacher or administrator authorization required'; END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DO $$
DECLARE t text;
BEGIN
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
    EXECUTE format('DROP TRIGGER IF EXISTS phase1_sensitive_write_guard ON public.%I', t);
    EXECUTE format('CREATE TRIGGER phase1_sensitive_write_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.phase1_sensitive_write_guard()', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Safe LMS RPCs. The original SECURITY DEFINER functions are retained for
-- internal compatibility but are no longer callable by the client role.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.lms_course_stats(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lms_student_course_progress(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lms_leaderboard(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lms_submit_quiz_attempt(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lms_check_and_award_badges(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.phase1_lms_course_stats(p_course_id uuid DEFAULT NULL)
RETURNS TABLE(total_courses bigint, published_courses bigint, total_lessons bigint, total_enrollments bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN
  IF NOT public.phase1_lms_admin() THEN RAISE EXCEPTION 'LMS staff authorization required'; END IF;
  RETURN QUERY SELECT * FROM public.lms_course_stats(p_course_id);
END $$;

CREATE OR REPLACE FUNCTION public.phase1_lms_student_course_progress(p_course_id uuid, p_student_id uuid)
RETURNS TABLE(lessons_total bigint, lessons_completed bigint, quizzes_taken bigint, quiz_average_percent numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN
  IF NOT (public.phase1_student_scope(p_student_id) AND EXISTS (
    SELECT 1 FROM public.lms_enrollments e WHERE e.course_id = p_course_id AND e.student_id = p_student_id AND e.organization_id = public.current_user_org_id()
  )) THEN RAISE EXCEPTION 'LMS student scope required'; END IF;
  RETURN QUERY SELECT * FROM public.lms_student_course_progress(p_course_id, p_student_id);
END $$;

CREATE OR REPLACE FUNCTION public.phase1_lms_leaderboard(p_course_id uuid)
RETURNS TABLE(student_id uuid, student_name text, lessons_done bigint, avg_quiz_percent numeric, rank_position bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN
  IF NOT (public.phase1_teacher_course_scope(p_course_id) OR (public.phase1_active_role() = 'student' AND EXISTS (
    SELECT 1 FROM public.lms_enrollments e WHERE e.course_id = p_course_id AND e.status IN ('active','completed') AND e.student_id IN (SELECT x.student_id FROM public.my_linked_student_ids())
  ))) THEN RAISE EXCEPTION 'LMS course access required'; END IF;
  RETURN QUERY SELECT * FROM public.lms_leaderboard(p_course_id);
END $$;

CREATE OR REPLACE FUNCTION public.phase1_lms_submit_quiz_attempt(p_quiz_id uuid, p_student_id uuid, p_answers jsonb)
RETURNS TABLE(attempt_id uuid, score_result numeric, percentage_result numeric, passed_result boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_course uuid;
BEGIN
  IF NOT public.phase1_own_student(p_student_id) THEN RAISE EXCEPTION 'Only the authenticated student may submit an attempt'; END IF;
  SELECT l.course_id INTO v_course FROM public.lms_lessons l JOIN public.lms_quizzes q ON q.lesson_id = l.id WHERE q.id = p_quiz_id AND q.organization_id = public.current_user_org_id();
  IF v_course IS NULL OR NOT EXISTS (SELECT 1 FROM public.lms_enrollments e WHERE e.course_id = v_course AND e.student_id = p_student_id AND e.status = 'active' AND e.organization_id = public.current_user_org_id()) THEN RAISE EXCEPTION 'Student is not enrolled in this course'; END IF;
  RETURN QUERY SELECT * FROM public.lms_submit_quiz_attempt(p_quiz_id, p_student_id, p_answers);
END $$;

CREATE OR REPLACE FUNCTION public.phase1_lms_check_and_award_badges(p_student_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN
  IF NOT (public.phase1_own_student(p_student_id) OR public.phase1_lms_admin()) THEN RAISE EXCEPTION 'LMS student scope required'; END IF;
  RETURN public.lms_check_and_award_badges(p_student_id);
END $$;

-- Sanitized quiz questions: answer keys are removed before the row crosses
-- the database boundary.
CREATE OR REPLACE FUNCTION public.phase1_lms_get_quiz_questions(p_quiz_id uuid)
RETURNS TABLE(id uuid, question_text text, options jsonb, explanation text, marks numeric, sort_order integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_course uuid;
BEGIN
  SELECT l.course_id INTO v_course FROM public.lms_lessons l JOIN public.lms_quizzes q ON q.lesson_id = l.id WHERE q.id = p_quiz_id AND q.organization_id = public.current_user_org_id();
  IF v_course IS NULL OR NOT (
    public.phase1_teacher_course_scope(v_course)
    OR (public.phase1_active_role() = 'student' AND EXISTS (SELECT 1 FROM public.lms_enrollments e WHERE e.course_id = v_course AND e.status IN ('active','completed') AND e.student_id IN (SELECT x.student_id FROM public.my_linked_student_ids())))
  ) THEN RAISE EXCEPTION 'LMS course access required'; END IF;
  RETURN QUERY
  SELECT q.id, q.question_text,
    COALESCE((SELECT jsonb_agg(opt - 'is_correct') FROM jsonb_array_elements(COALESCE(q.options, '[]'::jsonb)) opt), '[]'::jsonb),
    q.explanation, q.marks, q.sort_order
  FROM public.lms_quiz_questions q
  WHERE q.quiz_id = p_quiz_id AND q.organization_id = public.current_user_org_id()
  ORDER BY q.sort_order;
END $$;

GRANT EXECUTE ON FUNCTION public.phase1_lms_course_stats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.phase1_lms_student_course_progress(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.phase1_lms_leaderboard(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.phase1_lms_submit_quiz_attempt(uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.phase1_lms_check_and_award_badges(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.phase1_lms_get_quiz_questions(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Stats RPC wrappers. SECURITY DEFINER aggregate functions are not protected
-- by table RLS, so only their role-appropriate wrappers remain client-callable.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.clinic_stats() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.payroll_stats() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assets_stats() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assets_with_book_value() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.hostel_stats() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.library_stats() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.transport_stats() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.procurement_stats() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.phase1_clinic_stats()
RETURNS TABLE(visits_today bigint, visits_this_week bigint, open_referrals bigint, patients_with_allergies bigint, low_stock_medications bigint, incidents_this_month bigint, vaccinations_due_soon bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN IF NOT public.phase1_clinic_access() THEN RAISE EXCEPTION 'Clinic authorization required'; END IF; RETURN QUERY SELECT * FROM public.clinic_stats(); END $$;
CREATE OR REPLACE FUNCTION public.phase1_payroll_stats()
RETURNS TABLE(total_staff_on_payroll bigint, total_monthly_gross numeric, active_components bigint, draft_runs bigint, unpaid_this_month bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN IF NOT public.phase1_finance_access() THEN RAISE EXCEPTION 'Finance authorization required'; END IF; RETURN QUERY SELECT * FROM public.payroll_stats(); END $$;
CREATE OR REPLACE FUNCTION public.phase1_assets_stats()
RETURNS TABLE(total_assets bigint, in_use_assets bigint, under_repair_assets bigint, disposed_assets bigint, total_purchase_cost numeric, total_book_value numeric, open_maintenance bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN IF NOT public.phase1_operations_access() THEN RAISE EXCEPTION 'Operations authorization required'; END IF; RETURN QUERY SELECT * FROM public.assets_stats(); END $$;
CREATE OR REPLACE FUNCTION public.phase1_assets_with_book_value()
RETURNS TABLE(id uuid, asset_code text, name text, category text, status text, purchase_cost numeric, book_value numeric, accumulated_depreciation numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN IF NOT public.phase1_operations_access() THEN RAISE EXCEPTION 'Operations authorization required'; END IF; RETURN QUERY SELECT * FROM public.assets_with_book_value(); END $$;
CREATE OR REPLACE FUNCTION public.phase1_hostel_stats()
RETURNS TABLE(total_houses bigint, total_beds bigint, occupied_beds bigint, available_beds bigint, open_incidents bigint, visitors_on_site bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN IF NOT public.phase1_operations_access() THEN RAISE EXCEPTION 'Operations authorization required'; END IF; RETURN QUERY SELECT * FROM public.hostel_stats(); END $$;
CREATE OR REPLACE FUNCTION public.phase1_library_stats()
RETURNS TABLE(total_titles bigint, total_copies bigint, available_copies bigint, active_loans bigint, overdue_loans bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN IF NOT public.phase1_operations_access() THEN RAISE EXCEPTION 'Operations authorization required'; END IF; RETURN QUERY SELECT * FROM public.library_stats(); END $$;
CREATE OR REPLACE FUNCTION public.phase1_transport_stats()
RETURNS TABLE(total_vehicles bigint, active_vehicles bigint, total_routes bigint, total_riders bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN IF NOT public.phase1_operations_access() THEN RAISE EXCEPTION 'Operations authorization required'; END IF; RETURN QUERY SELECT * FROM public.transport_stats(); END $$;
CREATE OR REPLACE FUNCTION public.phase1_procurement_stats()
RETURNS TABLE(pending_requests bigint, open_orders bigint, total_open_order_value numeric, received_this_month bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN IF NOT public.phase1_operations_access() THEN RAISE EXCEPTION 'Operations authorization required'; END IF; RETURN QUERY SELECT * FROM public.procurement_stats(); END $$;

GRANT EXECUTE ON FUNCTION public.phase1_clinic_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.phase1_payroll_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.phase1_assets_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.phase1_assets_with_book_value() TO authenticated;
GRANT EXECUTE ON FUNCTION public.phase1_hostel_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.phase1_library_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.phase1_transport_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.phase1_procurement_stats() TO authenticated;

-- Verification query for the SQL editor after application. Any remaining
-- permissive policy on a sensitive table should be investigated immediately.
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'students','student_enrollments','student_scores','attendance_records',
    'income_entries','expense_entries','vendors','bank_transactions','sms_inbox',
    'staff_members','roles','lms_courses','lms_enrollments','lms_lesson_progress',
    'clinic_patient_records','clinic_visits','payroll_payslips','assets',
    'library_loans','hostel_allocations','transport_student_assignments','procurement_orders'
  )
ORDER BY tablename, policyname;
