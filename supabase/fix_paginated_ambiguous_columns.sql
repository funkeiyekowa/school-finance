-- =====================================================================
-- FIX: "column reference ... is ambiguous" (Postgres error 42702) on
-- students_paginated / staff_paginated.
--
-- Root cause: a PL/pgSQL function with RETURNS TABLE(col1, col2, ...)
-- implicitly declares col1, col2, ... as OUT-parameter variables scoped
-- to the whole function body. students_paginated's OUT columns include
-- full_name, grade, gender, status, academic_year, admission_date,
-- first_name, last_name -- and staff_paginated's include full_name,
-- staff_code, email, status, staff_type, department_id, date_joined --
-- which are the EXACT SAME NAMES as the columns being searched/ordered
-- on the students / staff_members tables. Every bare, unqualified
-- reference to one of those names inside the function body is
-- ambiguous: Postgres cannot tell whether "full_name" means the OUT
-- variable or students.full_name / staff_members.full_name, and
-- raises 42702.
--
-- This didn't affect student_stats()/staff_stats() because those
-- functions' OUT columns (total_students, teaching, non_teaching, ...)
-- don't collide with any column name referenced in their bodies.
--
-- Fix: qualify every table-column reference with its table alias
-- (s.full_name, s.status, etc.) everywhere in both functions -- in the
-- COUNT(*) query, the RETURN QUERY SELECT, the WHERE clauses, and the
-- ORDER BY -- so there is no bare identifier left for Postgres to
-- misresolve against the OUT-parameter variable of the same name.
--
-- SAFE TO RE-RUN.
-- =====================================================================

CREATE OR REPLACE FUNCTION students_paginated(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT NULL,
  p_grade text DEFAULT NULL,
  p_gender text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_sort_by text DEFAULT 'last_name'
)
RETURNS TABLE (
  id uuid,
  student_code text,
  full_name text,
  last_name text,
  first_name text,
  middle_name text,
  grade text,
  gender text,
  guardian_name text,
  guardian_phone text,
  status text,
  academic_year text,
  admission_date date,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_total bigint;
BEGIN
  SELECT COUNT(*) INTO v_total FROM students s
  WHERE s.organization_id = v_org
    AND (p_search IS NULL OR
         s.full_name ILIKE '%' || p_search || '%' OR
         s.student_code ILIKE '%' || p_search || '%')
    AND (p_grade IS NULL OR s.grade = p_grade)
    AND (p_gender IS NULL OR s.gender = p_gender)
    AND (p_status IS NULL OR s.status = p_status);

  RETURN QUERY
  SELECT
    s.id, s.student_code, s.full_name, s.last_name, s.first_name,
    s.middle_name, s.grade, s.gender, s.guardian_name, s.guardian_phone,
    s.status, s.academic_year, s.admission_date,
    v_total as total_count
  FROM students s
  WHERE s.organization_id = v_org
    AND (p_search IS NULL OR
         s.full_name ILIKE '%' || p_search || '%' OR
         s.student_code ILIKE '%' || p_search || '%')
    AND (p_grade IS NULL OR s.grade = p_grade)
    AND (p_gender IS NULL OR s.gender = p_gender)
    AND (p_status IS NULL OR s.status = p_status)
  ORDER BY
    CASE WHEN p_sort_by = 'first_name' THEN s.first_name
         WHEN p_sort_by = 'created_at' THEN s.created_at::text
         ELSE s.last_name
    END,
    CASE WHEN p_sort_by != 'first_name' THEN s.first_name ELSE '' END
  LIMIT p_limit OFFSET p_offset;
END $$;

GRANT EXECUTE ON FUNCTION students_paginated(integer, integer, text, text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION staff_paginated(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT NULL,
  p_staff_type text DEFAULT NULL,
  p_department_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_sort_by text DEFAULT 'full_name'
)
RETURNS TABLE (
  id uuid,
  staff_code text,
  full_name text,
  email text,
  phone text,
  job_title text,
  staff_type text,
  department_id uuid,
  status text,
  date_joined date,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_total bigint;
BEGIN
  SELECT COUNT(*) INTO v_total FROM staff_members s
  WHERE s.organization_id = v_org
    AND (p_search IS NULL OR
         s.full_name ILIKE '%' || p_search || '%' OR
         s.staff_code ILIKE '%' || p_search || '%' OR
         s.email ILIKE '%' || p_search || '%')
    AND (p_staff_type IS NULL OR s.staff_type = p_staff_type)
    AND (p_department_id IS NULL OR s.department_id = p_department_id)
    AND (p_status IS NULL OR s.status = p_status);

  RETURN QUERY
  SELECT
    s.id, s.staff_code, s.full_name, s.email, s.phone,
    s.job_title, s.staff_type, s.department_id, s.status,
    s.date_joined,
    v_total as total_count
  FROM staff_members s
  WHERE s.organization_id = v_org
    AND (p_search IS NULL OR
         s.full_name ILIKE '%' || p_search || '%' OR
         s.staff_code ILIKE '%' || p_search || '%' OR
         s.email ILIKE '%' || p_search || '%')
    AND (p_staff_type IS NULL OR s.staff_type = p_staff_type)
    AND (p_department_id IS NULL OR s.department_id = p_department_id)
    AND (p_status IS NULL OR s.status = p_status)
  ORDER BY
    CASE WHEN p_sort_by = 'email' THEN s.email
         WHEN p_sort_by = 'date_joined' THEN s.date_joined::text
         ELSE s.full_name
    END
  LIMIT p_limit OFFSET p_offset;
END $$;

GRANT EXECUTE ON FUNCTION staff_paginated(integer, integer, text, text, uuid, text, text) TO authenticated;
