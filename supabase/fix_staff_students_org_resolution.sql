-- =====================================================================
-- FIX: students_paginated / staff_paginated / stats / filter-options RPCs
-- were resolving the caller's org from profiles.organization_id, a
-- legacy column that is set once during migration and never updated
-- again. The app's real "which org is active" state lives in
-- org_memberships.is_default (switch_active_org() flips it), and every
-- RLS policy in this app already resolves through current_user_org_id()
-- for exactly that reason.
--
-- Symptom this fixes: a super_admin who switches into another org's
-- context (e.g. "Grant Schools") saw "No staff found" / 0 stats on the
-- Staff and Students pages even though the data was never deleted --
-- the RPCs were silently querying the wrong (stale/home) org.
--
-- Also adds staff_stats() and staff_filter_options(), which the Staff
-- page's frontend already calls but which never existed in the
-- database -- a second, independent bug that was zeroing out the 4
-- stat tiles (the RPC call failed silently; only console.error'd).
--
-- SAFE TO RE-RUN: CREATE OR REPLACE. Run this AFTER
-- paginate_students_and_staff.sql (or standalone -- it recreates every
-- function paginate_students_and_staff.sql defines, using the same
-- signatures, so it's a strict superset / drop-in replacement).
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
  SELECT COUNT(*) INTO v_total FROM students
  WHERE organization_id = v_org
    AND (p_search IS NULL OR
         full_name ILIKE '%' || p_search || '%' OR
         student_code ILIKE '%' || p_search || '%')
    AND (p_grade IS NULL OR grade = p_grade)
    AND (p_gender IS NULL OR gender = p_gender)
    AND (p_status IS NULL OR status = p_status);

  RETURN QUERY
  SELECT
    s.id, s.student_code, s.full_name, s.last_name, s.first_name,
    s.middle_name, s.grade, s.gender, s.guardian_name, s.guardian_phone,
    s.status, s.academic_year, s.admission_date,
    v_total as total_count
  FROM students s
  WHERE organization_id = v_org
    AND (p_search IS NULL OR
         full_name ILIKE '%' || p_search || '%' OR
         student_code ILIKE '%' || p_search || '%')
    AND (p_grade IS NULL OR grade = p_grade)
    AND (p_gender IS NULL OR gender = p_gender)
    AND (p_status IS NULL OR status = p_status)
  ORDER BY
    CASE WHEN p_sort_by = 'first_name' THEN first_name
         WHEN p_sort_by = 'created_at' THEN created_at::text
         ELSE last_name
    END,
    CASE WHEN p_sort_by != 'first_name' THEN first_name ELSE '' END
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
  SELECT COUNT(*) INTO v_total FROM staff_members
  WHERE organization_id = v_org
    AND (p_search IS NULL OR
         full_name ILIKE '%' || p_search || '%' OR
         staff_code ILIKE '%' || p_search || '%' OR
         email ILIKE '%' || p_search || '%')
    AND (p_staff_type IS NULL OR staff_type = p_staff_type)
    AND (p_department_id IS NULL OR department_id = p_department_id)
    AND (p_status IS NULL OR status = p_status);

  RETURN QUERY
  SELECT
    s.id, s.staff_code, s.full_name, s.email, s.phone,
    s.job_title, s.staff_type, s.department_id, s.status,
    s.date_joined,
    v_total as total_count
  FROM staff_members s
  WHERE organization_id = v_org
    AND (p_search IS NULL OR
         full_name ILIKE '%' || p_search || '%' OR
         staff_code ILIKE '%' || p_search || '%' OR
         email ILIKE '%' || p_search || '%')
    AND (p_staff_type IS NULL OR staff_type = p_staff_type)
    AND (p_department_id IS NULL OR department_id = p_department_id)
    AND (p_status IS NULL OR status = p_status)
  ORDER BY
    CASE WHEN p_sort_by = 'email' THEN s.email
         WHEN p_sort_by = 'date_joined' THEN s.date_joined::text
         ELSE s.full_name
    END
  LIMIT p_limit OFFSET p_offset;
END $$;

GRANT EXECUTE ON FUNCTION staff_paginated(integer, integer, text, text, uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION student_stats()
RETURNS TABLE (
  total_students bigint,
  active_students bigint,
  inactive_students bigint,
  graduated_students bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM students WHERE organization_id = v_org) as total_students,
    (SELECT COUNT(*) FROM students WHERE organization_id = v_org AND status = 'active') as active_students,
    (SELECT COUNT(*) FROM students WHERE organization_id = v_org AND status = 'inactive') as inactive_students,
    (SELECT COUNT(*) FROM students WHERE organization_id = v_org AND status = 'graduated') as graduated_students;
END $$;

GRANT EXECUTE ON FUNCTION student_stats() TO authenticated;

-- staff_stats() -- new. staff_type has 3 real values ('teaching',
-- 'non_teaching', 'admin' -- see operations_migration.sql and
-- fix_teacher_login_and_password_change.sql, which already treats
-- anything other than 'teaching' as non-teaching for role purposes).
-- non_teaching here is bucketed the same way: everyone who isn't
-- 'teaching', so total = teaching + non_teaching exactly.
CREATE OR REPLACE FUNCTION staff_stats()
RETURNS TABLE (
  total bigint,
  teaching bigint,
  non_teaching bigint,
  inactive bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM staff_members WHERE organization_id = v_org) as total,
    (SELECT COUNT(*) FROM staff_members WHERE organization_id = v_org AND staff_type = 'teaching') as teaching,
    (SELECT COUNT(*) FROM staff_members WHERE organization_id = v_org AND staff_type <> 'teaching') as non_teaching,
    (SELECT COUNT(*) FROM staff_members WHERE organization_id = v_org AND status = 'inactive') as inactive;
END $$;

GRANT EXECUTE ON FUNCTION staff_stats() TO authenticated;

CREATE OR REPLACE FUNCTION student_filter_options()
RETURNS TABLE (
  grades text[],
  genders text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
BEGIN
  RETURN QUERY
  SELECT
    (ARRAY_AGG(DISTINCT grade ORDER BY grade) FILTER (WHERE grade IS NOT NULL))::text[] as grades,
    (ARRAY_AGG(DISTINCT gender ORDER BY gender) FILTER (WHERE gender IS NOT NULL))::text[] as genders
  FROM students
  WHERE organization_id = v_org;
END $$;

GRANT EXECUTE ON FUNCTION student_filter_options() TO authenticated;

-- staff_filter_options() -- new, companion to student_filter_options()
-- for parity. Not currently called by the frontend.
CREATE OR REPLACE FUNCTION staff_filter_options()
RETURNS TABLE (
  staff_types text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
BEGIN
  RETURN QUERY
  SELECT
    (ARRAY_AGG(DISTINCT staff_type ORDER BY staff_type) FILTER (WHERE staff_type IS NOT NULL))::text[] as staff_types
  FROM staff_members
  WHERE organization_id = v_org;
END $$;

GRANT EXECUTE ON FUNCTION staff_filter_options() TO authenticated;
