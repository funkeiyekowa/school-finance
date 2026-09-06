-- =====================================================================
-- MAKE set_class_teacher() COEXIST WITH MANY-TO-MANY CLASS TEACHERS
-- =====================================================================
-- Two surfaces assign class teachers, both writing teacher_assignments
-- (role='class_teacher', subject_id=NULL):
--
--   1. Staff form  -> set_class_teacher(p_staff_id, p_class_id)
--   2. Class Teacher Allocation page -> add_class_teacher / remove_class_teacher
--      (class_teacher_allocation_module.sql), which are many-to-many.
--
-- PROBLEM: the old set_class_teacher() DEACTIVATED every other
-- class_teacher row for the target class ("one homeroom teacher per
-- class"). So setting a class teacher from the Staff form silently
-- removed all the OTHER class teachers the Allocation page had added to
-- that class. The two features fought each other.
--
-- FIX: redefine set_class_teacher() to ADD the staff member as a class
-- teacher WITHOUT deactivating the class's other class teachers -- i.e.
-- the same additive, many-to-many semantics as add_class_teacher().
-- Passing p_staff_id = NULL is now a NO-OP (there is no longer a single
-- "the" class teacher to clear); the Staff form clears a specific
-- teacher via remove_class_teacher(staff, class) instead (client change).
--
-- Net effect: both surfaces now COMPLETE each other --
--   * Staff form: ticking "Class Teacher" adds this person to the class.
--   * Allocation page: manages the full set for a class.
-- Neither removes the other's teachers.
--
-- Does NOT change subject-teacher logic. Idempotent. SAFE TO RE-RUN.
-- =====================================================================

CREATE OR REPLACE FUNCTION set_class_teacher(p_staff_id uuid, p_class_id uuid)
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

  -- p_staff_id = NULL is now a no-op. Class teachers are many-to-many, so
  -- there is no single occupant to "clear" for a class. Removing a
  -- specific teacher is done with remove_class_teacher(staff, class).
  IF p_staff_id IS NULL THEN
    RETURN;
  END IF;

  IF p_class_id IS NULL THEN
    RAISE EXCEPTION 'A class is required.';
  END IF;

  SELECT user_id INTO v_user_id FROM staff_members
  WHERE id = p_staff_id AND organization_id = v_org;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'This staff member has no linked login account, so they cannot be assigned as class teacher yet.';
  END IF;

  -- Additive, sibling-preserving (matches add_class_teacher). NULL
  -- subject_id defeats ON CONFLICT (SQL NULL-distinct), so UPDATE-else-INSERT.
  UPDATE teacher_assignments
  SET role = 'class_teacher', active = true
  WHERE user_id = v_user_id
    AND class_id = p_class_id
    AND subject_id IS NULL
    AND organization_id = v_org;

  IF NOT FOUND THEN
    INSERT INTO teacher_assignments (user_id, class_id, subject_id, role, organization_id, active)
    VALUES (v_user_id, p_class_id, NULL, 'class_teacher', v_org, true);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION set_class_teacher(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- VERIFY: set_class_teacher must no longer contain the blanket
-- "deactivate every class_teacher for this class" step. Expect
-- deactivates_siblings = false.
-- ---------------------------------------------------------------------
SELECT
  position('regardless of which staff' in pg_get_functiondef(oid)) > 0 AS still_has_old_comment,
  (lower(pg_get_functiondef(oid)) LIKE '%set active = false%' ) AS deactivates_siblings
FROM pg_proc WHERE proname = 'set_class_teacher';
