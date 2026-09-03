-- =====================================================================
-- COMBINED FIX: staff_paginated() - qualify columns + add salary
--
-- This fixes TWO issues:
-- 1. Column reference ambiguity (Postgres 42702) by qualifying all
--    table columns with the s. alias (from fix_paginated_ambiguous_columns)
-- 2. Missing salary column in RETURNS TABLE
--
-- SAFE TO RE-RUN.
-- =====================================================================

DROP FUNCTION IF EXISTS staff_paginated(integer, integer, text, text, uuid, text, text);

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
  salary numeric,
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
    s.date_joined, s.salary,
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
