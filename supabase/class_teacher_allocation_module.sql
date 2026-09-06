-- =====================================================================
-- CLASS TEACHER ALLOCATION MODULE (many-to-many)
-- =====================================================================
-- Lets an admin allocate classes to teaching staff, where:
--   * a class can have MANY class teachers, and
--   * a teacher can hold MANY classes.
--
-- This is the many-to-many companion to the SINGLE class-teacher helper
-- set_class_teacher() (supabase/signatures_and_class_teacher_module.sql),
-- which the Staff form uses to name one homeroom teacher per class and
-- which MUST remain unchanged. The two coexist: both write into the
-- existing teacher_assignments table (supabase/portals_migration.sql)
-- using role='class_teacher' and subject_id=NULL. No new schema.
--
-- Difference from set_class_teacher(): these RPCs add/remove ONE
-- (staff, class) pair at a time and NEVER deactivate a class's other
-- class-teacher rows, so multiple teachers can share a class.
--
-- Authorization: every function is SECURITY DEFINER and requires
-- is_org_admin(current_user_org_id()); everything is scoped to the
-- caller's active organization. The teacher_assignments RLS is
-- permissive by design (ta_write USING true) BECAUSE these definer RPCs
-- are the only supported write path -- the org check here is the gate.
--
-- SAFE TO RE-RUN (idempotent).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. RPC: add a class-teacher allocation (staff -> class), many-to-many.
--    Idempotent: re-adding an existing pair just re-activates it.
--    Because subject_id is NULL for class teachers and SQL treats NULLs
--    as distinct, ON CONFLICT(user_id,class_id,subject_id) cannot be
--    relied on here -- reactivate an existing NULL-subject row if one
--    exists, otherwise insert a fresh one (mirrors set_class_teacher).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION add_class_teacher(p_staff_id uuid, p_class_id uuid)
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

  IF p_staff_id IS NULL OR p_class_id IS NULL THEN
    RAISE EXCEPTION 'Both a staff member and a class are required.';
  END IF;

  -- The class must belong to this org.
  IF NOT EXISTS (SELECT 1 FROM classes WHERE id = p_class_id AND organization_id = v_org) THEN
    RAISE EXCEPTION 'That class does not belong to your school.';
  END IF;

  SELECT user_id INTO v_user_id FROM staff_members
  WHERE id = p_staff_id AND organization_id = v_org;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'This staff member has no linked login account, so they cannot be allocated as a class teacher yet.';
  END IF;

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

GRANT EXECUTE ON FUNCTION add_class_teacher(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 2. RPC: remove ONE class-teacher allocation (staff -> class).
--    Deactivates only that teacher's row for that class; other class
--    teachers of the same class are untouched.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION remove_class_teacher(p_staff_id uuid, p_class_id uuid)
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

  IF p_staff_id IS NULL OR p_class_id IS NULL THEN
    RAISE EXCEPTION 'Both a staff member and a class are required.';
  END IF;

  SELECT user_id INTO v_user_id FROM staff_members
  WHERE id = p_staff_id AND organization_id = v_org;

  IF v_user_id IS NULL THEN
    RETURN; -- nothing to remove
  END IF;

  UPDATE teacher_assignments
  SET active = false
  WHERE user_id = v_user_id
    AND class_id = p_class_id
    AND subject_id IS NULL
    AND role = 'class_teacher'
    AND organization_id = v_org;
END;
$$;

GRANT EXECUTE ON FUNCTION remove_class_teacher(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 3. RPC: list every active class-teacher allocation for this org.
--    Returns one row per (class, staff) pair, so a class with three
--    class teachers yields three rows.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION list_class_teacher_allocations()
RETURNS TABLE (
  class_id uuid,
  class_name text,
  staff_id uuid,
  staff_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT DISTINCT c.id, c.name, sm.id, sm.full_name
  FROM teacher_assignments ta
  JOIN classes c ON c.id = ta.class_id
  JOIN staff_members sm ON sm.user_id = ta.user_id AND sm.organization_id = ta.organization_id
  WHERE ta.organization_id = current_user_org_id()
    AND ta.role = 'class_teacher'
    AND ta.subject_id IS NULL
    AND ta.active = true;
$$;

GRANT EXECUTE ON FUNCTION list_class_teacher_allocations() TO authenticated;

-- ---------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------
SELECT
  (SELECT COUNT(*) FROM pg_proc WHERE proname = 'add_class_teacher')             AS add_class_teacher_installed,
  (SELECT COUNT(*) FROM pg_proc WHERE proname = 'remove_class_teacher')          AS remove_class_teacher_installed,
  (SELECT COUNT(*) FROM pg_proc WHERE proname = 'list_class_teacher_allocations') AS list_class_teacher_allocations_installed;
