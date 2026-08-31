-- =====================================================================
-- PAGINATION RPCs FOR STUDENTS & STAFF
-- =====================================================================
-- Run order: after tenant_isolation_full.sql (defines RLS)
--
-- WHY: Current pages load entire table with select("*") and filter
-- client-side. At scale (10K+ rows), this causes:
--   - Network bloat (transferring unnecessary data)
--   - Browser memory bloat (holds all rows in state)
--   - Lag on filter/sort (100ms+ keystroke lag at 2K+ rows)
--   - Page crashes at 20K+ rows
--
-- Solution: RPC functions that handle pagination, filtering, sorting
-- server-side. Page receives 50 rows at a time, fast queries.
--
-- SAFE TO RE-RUN: CREATE OR REPLACE
-- =====================================================================

-- =========================================
-- 1. INDEXES FOR PERFORMANCE
-- =========================================
-- (These should already exist from schema; re-creating doesn't hurt.)
CREATE INDEX IF NOT EXISTS idx_students_org_status ON students(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_students_org_grade ON students(organization_id, grade);
CREATE INDEX IF NOT EXISTS idx_students_org_name ON students(organization_id, last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_staff_org_status ON staff_members(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_staff_org_type ON staff_members(organization_id, staff_type);

-- =========================================
-- 2. STUDENTS PAGINATION RPC
-- =========================================
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
  v_org uuid := (SELECT organization_id FROM profiles WHERE id = auth.uid());
  v_total bigint;
BEGIN
  -- Calculate total matching records
  SELECT COUNT(*) INTO v_total FROM students
  WHERE organization_id = v_org
    AND (p_search IS NULL OR 
         full_name ILIKE '%' || p_search || '%' OR 
         student_code ILIKE '%' || p_search || '%')
    AND (p_grade IS NULL OR grade = p_grade)
    AND (p_gender IS NULL OR gender = p_gender)
    AND (p_status IS NULL OR status = p_status);

  -- Return paginated & filtered results
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

-- =========================================
-- 3. STAFF PAGINATION RPC
-- =========================================
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
  v_org uuid := (SELECT organization_id FROM profiles WHERE id = auth.uid());
  v_total bigint;
BEGIN
  -- Calculate total matching records
  SELECT COUNT(*) INTO v_total FROM staff_members
  WHERE organization_id = v_org
    AND (p_search IS NULL OR 
         full_name ILIKE '%' || p_search || '%' OR 
         staff_code ILIKE '%' || p_search || '%' OR 
         email ILIKE '%' || p_search || '%')
    AND (p_staff_type IS NULL OR staff_type = p_staff_type)
    AND (p_department_id IS NULL OR department_id = p_department_id)
    AND (p_status IS NULL OR status = p_status);

  -- Return paginated & filtered results
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

-- =========================================
-- 4. STATS RPC — FAST COUNTS FOR UI
-- =========================================
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
  v_org uuid := (SELECT organization_id FROM profiles WHERE id = auth.uid());
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM students WHERE organization_id = v_org) as total_students,
    (SELECT COUNT(*) FROM students WHERE organization_id = v_org AND status = 'active') as active_students,
    (SELECT COUNT(*) FROM students WHERE organization_id = v_org AND status = 'inactive') as inactive_students,
    (SELECT COUNT(*) FROM students WHERE organization_id = v_org AND status = 'graduated') as graduated_students;
END $$;

GRANT EXECUTE ON FUNCTION student_stats() TO authenticated;

-- =========================================
-- 5. FILTER OPTIONS RPC — FOR DROPDOWNS
-- =========================================
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
  v_org uuid := (SELECT organization_id FROM profiles WHERE id = auth.uid());
BEGIN
  RETURN QUERY
  SELECT
    (ARRAY_AGG(DISTINCT grade ORDER BY grade) FILTER (WHERE grade IS NOT NULL))::text[] as grades,
    (ARRAY_AGG(DISTINCT gender ORDER BY gender) FILTER (WHERE gender IS NOT NULL))::text[] as genders
  FROM students
  WHERE organization_id = v_org;
END $$;

GRANT EXECUTE ON FUNCTION student_filter_options() TO authenticated;
