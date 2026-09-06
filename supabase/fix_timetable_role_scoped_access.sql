-- =====================================================================
-- ROLE-SCOPED TIMETABLE ACCESS  (security fix)
-- =====================================================================
-- PROBLEM (confirmed live): timetable_entries' only SELECT policy was
-- rls_role_scoped_access.sql's generic "reference table" treatment --
-- FOR SELECT USING (organization_id = current_user_org_id()) -- which
-- is correct for org-wide non-sensitive config (classes, subjects,
-- periods) but wrong here: it let ANY active org member, including a
-- student or a teacher with no relationship to a class, read every
-- other class's schedule (which teacher teaches what, when, in which
-- room) for the whole school. The timetable page's class selector and
-- unfiltered `.select("*")` only ever relied on this table-wide policy
-- -- there was no server-side scoping to remove or duplicate.
--
-- FIX: replace that one SELECT policy with a role-scoped one. Nothing
-- else changes -- classes/subjects/periods stay org-wide readable
-- (unchanged, not sensitive on their own), and the three staff-only
-- write policies on timetable_entries are recreated identically.
--
-- SOURCE OF TRUTH REUSED (no new assignment data):
--   * teacher_assignments (portals_migration.sql) -- role='class_teacher'
--     (subject_id NULL) or role='subject_teacher' (subject_id set).
--     A teacher's authorized class set is the union of both roles for
--     that user, which is just "any active row for that class" -- no
--     role filter needed to get the union.
--   * student_current_class_id() (cbt_upgrade_migration.sql) -- already
--     the CBT system's own way of resolving a student's current class
--     via student_enrollments (status='active'), reused as-is.
--   * my_linked_student_ids() (rls_role_scoped_access.sql) -- already
--     unions "my own student row" and "my children as a parent", so
--     this fix also naturally scopes a parent to their child's class
--     instead of leaving them on the old org-wide policy (same class
--     of bug, same fix, at no extra cost -- no parent-facing timetable
--     UI exists today, this is pure defense in depth).
--   * is_staff_user() (rls_role_scoped_access.sql) -- reused role list,
--     minus 'teacher', for the "full access" branch.
--
-- ENFORCEMENT LAYER: this is a Postgres RLS policy on the table itself,
-- so it applies to EVERY read path -- the timetable page's plain
-- `.select("*")`, the print page's `.eq("class_id", ...)`, and any
-- future RPC or API route -- uniformly. A student changing the
-- `?class=` query param or calling the table directly gets zero rows
-- for a class they are not authorized for; there is no separate
-- code path to bypass.
--
-- IDEMPOTENT. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Helper: is the caller staff, but NOT specifically via the
--    'teacher' role? (owner/admin/editor/staff/bursar/accountant/
--    developer/super_admin/viewer -- everything is_staff_user() covers
--    except 'teacher'). Mirrors is_staff_user()'s own dual-path
--    (org_memberships primary, profiles fallback for legacy installs).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_non_teacher_staff()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.org_memberships m
      WHERE m.user_id = auth.uid()
        AND m.active = true
        AND m.role IN ('owner','admin','editor','staff','bursar',
                       'accountant','developer','super_admin','viewer')
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND COALESCE(p.active, true) = true
        AND p.role IN ('owner','admin','editor','staff','bursar',
                       'accountant','developer','super_admin','viewer')
    );
$$;
GRANT EXECUTE ON FUNCTION public.is_non_teacher_staff() TO authenticated;

-- ---------------------------------------------------------------------
-- 2. Helper: does the caller hold an ACTIVE class_teacher OR
--    subject_teacher assignment for this class? teacher_assignments
--    has one row per (user, class, subject); checking for ANY active
--    row for the class (no role filter) IS the union of both roles by
--    construction. SECURITY DEFINER so this keeps working regardless
--    of teacher_assignments' own RLS policy shape.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_assigned_to_class(p_class uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.teacher_assignments ta
    WHERE ta.user_id = auth.uid()
      AND ta.class_id = p_class
      AND ta.active = true
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_assigned_to_class(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 3. Helper: is this class the caller's own current class (as a
--    student) or their child's current class (as a parent)? Reuses
--    my_linked_student_ids() + student_current_class_id() as-is.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_my_current_class(p_class uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.my_linked_student_ids() lsid
    WHERE public.student_current_class_id(lsid.student_id) = p_class
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_my_current_class(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 4. Convenience RPC for the client: the caller's OWN current class id
--    (student only; NULL for anyone else / no active enrollment). Used
--    by the timetable page to auto-select and hide the class selector
--    for students -- pure read convenience, not a new assignment source.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_current_class_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.student_current_class_id(s.id)
  FROM public.students s
  WHERE s.profile_id = auth.uid()
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_my_current_class_id() TO authenticated;

-- ---------------------------------------------------------------------
-- 5. Rewrite timetable_entries policies: role-scoped SELECT, identical
--    staff-only INSERT/UPDATE/DELETE (unchanged from
--    rls_role_scoped_access.sql's generic ref-table treatment).
-- ---------------------------------------------------------------------
SELECT public._reset_policies('timetable_entries');

CREATE POLICY timetable_entries_role_scoped_read ON public.timetable_entries
FOR SELECT USING (
  organization_id = current_user_org_id()
  AND (
    public.is_non_teacher_staff()
    OR public.is_assigned_to_class(class_id)
    OR public.is_my_current_class(class_id)
  )
);

CREATE POLICY timetable_entries_staff_insert ON public.timetable_entries FOR INSERT
  WITH CHECK (organization_id = current_user_org_id() AND public.is_staff_user());
CREATE POLICY timetable_entries_staff_update ON public.timetable_entries FOR UPDATE
  USING (organization_id = current_user_org_id() AND public.is_staff_user())
  WITH CHECK (organization_id = current_user_org_id() AND public.is_staff_user());
CREATE POLICY timetable_entries_staff_delete ON public.timetable_entries FOR DELETE
  USING (organization_id = current_user_org_id() AND public.is_staff_user());

-- =====================================================================
-- VERIFICATION
-- =====================================================================
-- 1. Policies now on timetable_entries (expect exactly these 4).
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'timetable_entries'
ORDER BY policyname;

-- 2. Helpers installed.
SELECT
  (SELECT COUNT(*) FROM pg_proc WHERE proname = 'is_non_teacher_staff')   AS is_non_teacher_staff_installed,
  (SELECT COUNT(*) FROM pg_proc WHERE proname = 'is_assigned_to_class')   AS is_assigned_to_class_installed,
  (SELECT COUNT(*) FROM pg_proc WHERE proname = 'is_my_current_class')    AS is_my_current_class_installed,
  (SELECT COUNT(*) FROM pg_proc WHERE proname = 'get_my_current_class_id') AS get_my_current_class_id_installed;

-- 3. Sanity: no row in timetable_entries can be read by role-scoped
--    check alone without EITHER staff, an assignment, or an enrollment
--    match -- i.e. confirm the policy actually restricts (not USING true).
SELECT pg_get_expr(pol.polqual, pol.polrelid) AS role_scoped_read_qual
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
WHERE c.relname = 'timetable_entries' AND pol.polname = 'timetable_entries_role_scoped_read';
