-- =====================================================================
-- STAFF TEACHING ASSIGNMENTS READBACK
-- =====================================================================
-- Lets the Staff form reflect, read-only, EVERYTHING a staff member is
-- assigned to across the Class Teacher Allocation and Subject Teacher
-- Allocation pages -- and vice-versa (all three surfaces read the same
-- teacher_assignments table, so a change on any page shows on the others).
--
-- Returns, for one staff member in the caller's org, every ACTIVE:
--   * class_teacher row  (kind='class_teacher', subject_name NULL)
--   * subject_teacher row (kind='subject_teacher', with class + subject)
--
-- SECURITY DEFINER, org-scoped, admin-gated. Read-only. SAFE TO RE-RUN.
-- =====================================================================

CREATE OR REPLACE FUNCTION list_staff_teaching_assignments(p_staff_id uuid)
RETURNS TABLE (
  kind text,
  class_id uuid,
  class_name text,
  subject_id uuid,
  subject_name text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_user_id uuid;
BEGIN
  IF v_org IS NULL OR NOT is_org_admin(v_org) THEN
    RAISE EXCEPTION 'Not authorized.';
  END IF;

  SELECT user_id INTO v_user_id FROM staff_members
  WHERE id = p_staff_id AND organization_id = v_org;

  IF v_user_id IS NULL THEN
    RETURN; -- no linked login => no assignments to show
  END IF;

  RETURN QUERY
  SELECT
    ta.role::text AS kind,
    c.id, c.name,
    sub.id, sub.name
  FROM teacher_assignments ta
  JOIN classes c ON c.id = ta.class_id
  LEFT JOIN subjects sub ON sub.id = ta.subject_id
  WHERE ta.organization_id = v_org
    AND ta.user_id = v_user_id
    AND ta.active = true
    AND ta.role IN ('class_teacher', 'subject_teacher')
  ORDER BY ta.role, c.name, sub.name NULLS FIRST;
END;
$$;

GRANT EXECUTE ON FUNCTION list_staff_teaching_assignments(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------
SELECT (SELECT COUNT(*) FROM pg_proc WHERE proname = 'list_staff_teaching_assignments') AS installed;
