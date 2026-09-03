-- =====================================================================
-- STAFF DUAL-ROLE ("Also a Teacher") MODULE
-- =====================================================================
-- Lets an admin mark a staff member (whose login role in org_memberships
-- is something other than 'teacher' -- admin, bursar, owner, editor,
-- staff, accountant, developer) as ALSO teaching, so they see the
-- Teacher's Portal nav group (My Teaching, Attendance, Assessments,
-- CBT/Exams) in addition to their normal access.
--
-- DELIBERATELY SCOPED NARROW: org_memberships has UNIQUE(user_id,
-- organization_id) -- a person can only hold ONE role per school, so
-- this cannot and does not try to give them a second real role. Every
-- page under Teacher's Portal already grants full, unrestricted access
-- to admin-ish roles (only a literal 'teacher' role gets scoped down to
-- their own assigned classes via teacher_assignments -- see
-- attendance/page.tsx), so flipping this flag only needs to affect nav
-- *visibility* in AppShell.tsx, not any RLS policy. No database
-- security rules change.
--
-- The reverse direction (a person whose ONLY role is 'teacher' also
-- reaching Finance/Students & Academics/People/etc, which genuinely IS
-- blocked today by RLS on those tables) is intentionally NOT covered
-- here -- that needs its own careful RLS-by-RLS review across many
-- tables, per Deji's own choice when asked about scope.
--
-- SAFE TO RE-RUN.
-- =====================================================================

ALTER TABLE staff_members
  ADD COLUMN IF NOT EXISTS dual_role boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN staff_members.dual_role IS
  'When true, this staff member also sees the Teacher''s Portal nav (My Teaching, Attendance, Assessments, CBT), on top of their normal staff/admin access. Set from the "Also a Teacher" checkbox on Staff setup.';

-- ---------------------------------------------------------------------
-- staff_paginated(): add dual_role to the columns the Staff Directory
-- page reads, alongside the existing salary column (fix_staff_paginated_
-- with_salary_qualified.sql is the prior definition this replaces).
-- ---------------------------------------------------------------------
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
  dual_role boolean,
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
    s.date_joined, s.salary, s.dual_role,
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

-- ---------------------------------------------------------------------
-- Self-service read: AppShell needs to check the SIGNED-IN user's own
-- dual_role flag (matched by email, same pattern as update_my_staff_photo)
-- to decide nav visibility. staff_members has tenant RLS already, but a
-- plain SELECT ... WHERE email = <mine> works fine under that policy
-- for the caller's own org -- no new RLS needed, this is just a note
-- confirming AppShell's client-side .ilike("email", user.email) query
-- against staff_members will be readable under the existing tenant
-- policy.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------
SELECT 'staff_members.dual_role' AS column_check, COUNT(*) AS n
FROM information_schema.columns
WHERE table_name = 'staff_members' AND column_name = 'dual_role';

SELECT 'dual_role totals' AS metric,
       COUNT(*) FILTER (WHERE dual_role) AS n_true,
       COUNT(*) FILTER (WHERE NOT dual_role) AS n_false
FROM staff_members;
