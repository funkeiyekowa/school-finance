-- =====================================================================
-- FIX: student_stats() is missing gender breakdown
-- =====================================================================
-- The Students page shows Male / Female stat cards. Before the
-- server-side pagination refactor, those counts were derived client-side
-- from the FULL (unpaginated) student list. After moving to
-- students_paginated() (50 rows/page), computing gender counts from the
-- current page would silently show per-page counts instead of the whole
-- school's -- wrong and misleading.
--
-- This is a minimal, additive extension of the EXISTING student_stats()
-- RPC (see fix_staff_students_org_resolution.sql) with two more org-scoped
-- aggregate columns. No new tables, no new infra, same SECURITY DEFINER +
-- current_user_org_id() scoping as the rest of the function.
--
-- Idempotent. Manual apply (per project convention). Verification SELECT
-- at the end.
-- =====================================================================

CREATE OR REPLACE FUNCTION student_stats()
RETURNS TABLE (
  total_students bigint,
  active_students bigint,
  inactive_students bigint,
  graduated_students bigint,
  male_students bigint,
  female_students bigint
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
    (SELECT COUNT(*) FROM students WHERE organization_id = v_org AND status = 'graduated') as graduated_students,
    (SELECT COUNT(*) FROM students WHERE organization_id = v_org AND gender = 'Male') as male_students,
    (SELECT COUNT(*) FROM students WHERE organization_id = v_org AND gender = 'Female') as female_students;
END $$;

GRANT EXECUTE ON FUNCTION student_stats() TO authenticated;

-- ---------------------------------------------------------------------
-- Verification: run as a signed-in org member. Expect one row with all
-- six counts, male + female <= total (some students may have no gender
-- recorded).
-- ---------------------------------------------------------------------
SELECT * FROM student_stats();
