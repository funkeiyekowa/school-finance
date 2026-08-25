-- ============================================================
-- FIX SETUP ISSUES
-- Run after saas_foundation.sql.
--
-- Fixes:
--   1. Seeds departments table with standard school departments
--      (Science, Arts, Commercial, Primary) so the Staff page
--      dropdown has options.
--   2. Adds a 'term' column to academic_years so terms can be
--      tracked per academic year (Term 1, Term 2, Term 3).
--   3. Adds report-related columns to student_scores for
--      teacher/principal comments and a release flag.
-- ============================================================

-- ==========================================================
-- 1. DEPARTMENTS — seed defaults
-- ==========================================================
-- The departments table may already exist from operations_migration.sql.
-- If not, create it.
CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  head_of_department text,
  active boolean NOT NULL DEFAULT true,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE departments ADD COLUMN IF NOT EXISTS organization_id uuid
  REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "departments_read" ON departments;
DROP POLICY IF EXISTS "departments_write" ON departments;
CREATE POLICY "departments_read" ON departments FOR SELECT
  USING (organization_id = current_user_org_id() OR organization_id IS NULL);
CREATE POLICY "departments_write" ON departments FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- Seed standard school departments for every org that doesn't have any
INSERT INTO departments (name, active, organization_id)
SELECT d.name, true, o.id
FROM organizations o
CROSS JOIN (VALUES
  ('Science'),
  ('Arts'),
  ('Commercial'),
  ('Primary'),
  ('Junior Secondary'),
  ('Senior Secondary'),
  ('Administration'),
  ('Support Staff')
) AS d(name)
WHERE NOT EXISTS (
  SELECT 1 FROM departments dp
  WHERE dp.organization_id = o.id AND dp.name = d.name
);

-- ==========================================================
-- 2. ACADEMIC YEARS — add term support
-- ==========================================================
-- Add a term field so each academic year row can represent a
-- specific term within the year. Schools that want per-term
-- setup create one row per term (e.g. "2026/2027 Term 1").
-- Schools that prefer whole-year tracking leave it null.
ALTER TABLE academic_years ADD COLUMN IF NOT EXISTS term text;
ALTER TABLE academic_years ADD COLUMN IF NOT EXISTS term_number integer;

-- Example: if a school wants per-term rows:
-- name: "2026/2027"  term: "Term 1"  term_number: 1  status: current
-- name: "2026/2027"  term: "Term 2"  term_number: 2  status: upcoming
-- name: "2026/2027"  term: "Term 3"  term_number: 3  status: upcoming

-- Update the unique index to allow the same year name with different terms
DROP INDEX IF EXISTS idx_academic_years_name_org;
CREATE UNIQUE INDEX IF NOT EXISTS idx_academic_years_name_term_org
  ON academic_years(name, COALESCE(term, ''), organization_id);

-- ==========================================================
-- 3. STUDENT SCORES — comments and release
-- ==========================================================
-- Check if student_scores table exists (from assessments_migration)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'student_scores') THEN

    -- Teacher comment per student per subject per term
    ALTER TABLE student_scores ADD COLUMN IF NOT EXISTS teacher_comment text;
    -- Principal comment (set by admin/owner only)
    ALTER TABLE student_scores ADD COLUMN IF NOT EXISTS principal_comment text;
    -- Conduct/behaviour grade
    ALTER TABLE student_scores ADD COLUMN IF NOT EXISTS conduct text;
    -- Attendance summary for the term
    ALTER TABLE student_scores ADD COLUMN IF NOT EXISTS days_present integer;
    ALTER TABLE student_scores ADD COLUMN IF NOT EXISTS days_absent integer;

    RAISE NOTICE 'Added comment and attendance columns to student_scores.';
  END IF;
END $$;

-- ==========================================================
-- 4. RESULTS RELEASE — per term per academic year per org
-- ==========================================================
-- A flag that controls whether students/parents can see results.
-- Only admins can flip this. Teachers enter scores but cannot
-- release them.
CREATE TABLE IF NOT EXISTS results_releases (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  academic_year_id uuid REFERENCES academic_years(id) ON DELETE CASCADE,
  term text NOT NULL DEFAULT 'Term 1',
  class_id uuid REFERENCES classes(id) ON DELETE CASCADE,
  released boolean NOT NULL DEFAULT false,
  released_at timestamptz,
  released_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (organization_id, academic_year_id, term, class_id)
);

ALTER TABLE results_releases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "releases_tenant_read" ON results_releases FOR SELECT
  USING (organization_id = current_user_org_id());
CREATE POLICY "releases_tenant_write" ON results_releases FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- ==========================================================
-- 5. FIX: staff_members org scoping (if missing)
-- ==========================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'staff_members') THEN
    ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS organization_id uuid
      REFERENCES organizations(id) ON DELETE CASCADE;

    UPDATE staff_members SET organization_id = (
      SELECT id FROM organizations WHERE slug = 'default' LIMIT 1
    ) WHERE organization_id IS NULL;

    -- RLS
    ALTER TABLE staff_members ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "staff_tenant_read" ON staff_members;
    DROP POLICY IF EXISTS "staff_tenant_write" ON staff_members;
    CREATE POLICY "staff_tenant_read" ON staff_members FOR SELECT
      USING (organization_id = current_user_org_id());
    CREATE POLICY "staff_tenant_write" ON staff_members FOR ALL
      USING (organization_id = current_user_org_id())
      WITH CHECK (organization_id = current_user_org_id());
  END IF;
END $$;
