-- =====================================================================
-- SUBJECT TEACHER ALLOCATION MODULE (item 14)
-- =====================================================================
-- Lets an admin assign a teacher to a class+subject pair (e.g. "Mrs.
-- Johnson teaches Mathematics to JSS1"). Writes into the *existing*
-- teacher_assignments table (supabase/portals_migration.sql) with
-- role='subject_teacher' and a real subject_id -- no new schema.
--
-- Unlike set_class_teacher() (one class_teacher per class, so it must
-- deactivate any existing row first), a class can have many subject
-- teachers -- one per subject -- so this can safely rely on
-- teacher_assignments' own UNIQUE(user_id, class_id, subject_id)
-- constraint via ON CONFLICT: subject_id is NOT NULL here, so the
-- NULL-distinct gotcha that affects set_class_teacher() does not apply.
--
-- SAFE TO RE-RUN.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. RPC: assign (or reassign) a teacher to a class+subject
-- ---------------------------------------------------------------------
-- Passing p_staff_id = NULL removes any existing assignment for that
-- class+subject instead of assigning a new teacher.
CREATE OR REPLACE FUNCTION set_subject_teacher(p_staff_id uuid, p_class_id uuid, p_subject_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_user_id uuid;
BEGIN
  IF v_org IS NULL OR NOT is_org_admin(v_org) THEN
    RAISE EXCEPTION 'Not authorized.';
  END IF;

  IF p_subject_id IS NULL THEN
    RAISE EXCEPTION 'A subject is required for a subject-teacher assignment.';
  END IF;

  IF p_staff_id IS NULL THEN
    -- Clear whichever teacher currently holds this class+subject slot.
    UPDATE teacher_assignments ta
    SET active = false
    FROM staff_members sm
    WHERE ta.user_id = sm.user_id
      AND ta.class_id = p_class_id
      AND ta.subject_id = p_subject_id
      AND ta.role = 'subject_teacher'
      AND ta.organization_id = v_org;
    RETURN;
  END IF;

  SELECT user_id INTO v_user_id FROM staff_members
  WHERE id = p_staff_id AND organization_id = v_org;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'This staff member has no linked login account, so they cannot be assigned as a subject teacher yet.';
  END IF;

  -- Deactivate any other teacher currently assigned to this exact
  -- class+subject slot (a slot should have one active subject teacher
  -- at a time, though a teacher may hold many slots).
  UPDATE teacher_assignments ta
  SET active = false
  FROM staff_members sm
  WHERE ta.user_id = sm.user_id
    AND ta.class_id = p_class_id
    AND ta.subject_id = p_subject_id
    AND ta.role = 'subject_teacher'
    AND ta.organization_id = v_org
    AND ta.user_id <> v_user_id;

  INSERT INTO teacher_assignments (user_id, class_id, subject_id, role, organization_id, active)
  VALUES (v_user_id, p_class_id, p_subject_id, 'subject_teacher', v_org, true)
  ON CONFLICT (user_id, class_id, subject_id)
  DO UPDATE SET role = 'subject_teacher', active = true;
END;
$$;

GRANT EXECUTE ON FUNCTION set_subject_teacher(uuid, uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 2. RPC: list current subject-teacher allocations for this org
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_subject_teachers()
RETURNS TABLE (
  class_id uuid,
  class_name text,
  subject_id uuid,
  subject_name text,
  staff_id uuid,
  staff_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT c.id, c.name, sub.id, sub.name, sm.id, sm.full_name
  FROM teacher_assignments ta
  JOIN classes c ON c.id = ta.class_id
  JOIN subjects sub ON sub.id = ta.subject_id
  JOIN staff_members sm ON sm.user_id = ta.user_id AND sm.organization_id = ta.organization_id
  WHERE ta.organization_id = current_user_org_id()
    AND ta.role = 'subject_teacher'
    AND ta.active = true;
$$;

GRANT EXECUTE ON FUNCTION list_subject_teachers() TO authenticated;

-- ---------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------
SELECT
  (SELECT COUNT(*) FROM pg_proc WHERE proname = 'set_subject_teacher') AS set_subject_teacher_installed,
  (SELECT COUNT(*) FROM pg_proc WHERE proname = 'list_subject_teachers') AS list_subject_teachers_installed;
