-- =====================================================================
-- FIX: staff_paginated() didn't return `salary`
-- =====================================================================
-- The Staff page has no way to show or edit a staff member's basic
-- salary because staff_paginated() (paginate_students_and_staff.sql)
-- never selected staff_members.salary in the first place. Combined
-- with the Staff add/edit form also having no Basic Salary field
-- (fixed in the same commit as this migration), every staff member's
-- basic salary silently defaulted to 0/NULL, which made every
-- percent_of_basic payroll component (PAYE, Pension) compute to 0 --
-- the payslip showed real allowances but ₦0 deductions.
--
-- RETURNS TABLE column sets can't be changed via CREATE OR REPLACE;
-- the function must be dropped first.
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
  v_org uuid := (SELECT organization_id FROM profiles WHERE id = auth.uid());
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
    s.date_joined, s.salary,
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
