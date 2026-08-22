-- ============================================================
-- ASSESSMENTS & GRADEBOOK SYSTEM
-- Run this in the Supabase SQL editor.
--
-- Creates:
--   1. assessment_types — configurable CA/Test/Exam weights
--   2. grading_scales — letter grade boundaries (A, B, C, etc.)
--   3. student_scores — one score per student per subject per type per term
-- ============================================================

-- ==========================================================
-- 1. ASSESSMENT TYPES — configurable per school
-- ==========================================================
CREATE TABLE IF NOT EXISTS assessment_types (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,                    -- "First CA", "Second CA", "Exam"
  short_code text NOT NULL,              -- "CA1", "CA2", "EXAM"
  weight numeric(5,2) NOT NULL DEFAULT 0, -- Percentage weight (e.g. 10, 20, 70)
  max_score numeric(6,2) NOT NULL DEFAULT 100, -- Maximum achievable score
  term text,                             -- Optional: "Term 1", null = all terms
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assessment_types_org ON assessment_types(organization_id);

-- Seed default assessment types
DO $$
DECLARE
  default_org_id uuid;
BEGIN
  SELECT id INTO default_org_id FROM organizations WHERE slug = 'default' LIMIT 1;
  IF default_org_id IS NOT NULL THEN
    INSERT INTO assessment_types (name, short_code, weight, max_score, sort_order, organization_id) VALUES
      ('First CA', 'CA1', 10, 10, 1, default_org_id),
      ('Second CA', 'CA2', 10, 10, 2, default_org_id),
      ('Assignment', 'ASG', 10, 10, 3, default_org_id),
      ('Examination', 'EXAM', 70, 70, 4, default_org_id)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- ==========================================================
-- 2. GRADING SCALES — configurable grade boundaries
-- ==========================================================
CREATE TABLE IF NOT EXISTS grading_scales (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  grade text NOT NULL,                   -- "A", "B", "C", "D", "E", "F"
  label text NOT NULL,                   -- "Excellent", "Very Good", etc.
  min_score numeric(5,2) NOT NULL,       -- Lower bound (inclusive)
  max_score numeric(5,2) NOT NULL,       -- Upper bound (inclusive)
  grade_point numeric(3,1) DEFAULT 0,    -- Optional GPA point value
  sort_order integer NOT NULL DEFAULT 0,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_grading_scales_org ON grading_scales(organization_id);

-- Seed default grading scale
DO $$
DECLARE
  default_org_id uuid;
BEGIN
  SELECT id INTO default_org_id FROM organizations WHERE slug = 'default' LIMIT 1;
  IF default_org_id IS NOT NULL THEN
    INSERT INTO grading_scales (grade, label, min_score, max_score, grade_point, sort_order, organization_id) VALUES
      ('A', 'Excellent', 70, 100, 5.0, 1, default_org_id),
      ('B', 'Very Good', 60, 69.99, 4.0, 2, default_org_id),
      ('C', 'Good', 50, 59.99, 3.0, 3, default_org_id),
      ('D', 'Fair', 45, 49.99, 2.0, 4, default_org_id),
      ('E', 'Pass', 40, 44.99, 1.0, 5, default_org_id),
      ('F', 'Fail', 0, 39.99, 0.0, 6, default_org_id)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- ==========================================================
-- 3. STUDENT SCORES — actual marks per student
-- ==========================================================
CREATE TABLE IF NOT EXISTS student_scores (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  assessment_type_id uuid NOT NULL REFERENCES assessment_types(id) ON DELETE CASCADE,
  class_id uuid REFERENCES classes(id) ON DELETE SET NULL,
  academic_year_id uuid REFERENCES academic_years(id) ON DELETE SET NULL,
  term text,                             -- "Term 1", "Term 2", "Term 3"
  score numeric(6,2),                    -- The actual score (null = not yet entered)
  remarks text,
  recorded_by text,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  -- One score per student per subject per assessment type per term
  UNIQUE(student_id, subject_id, assessment_type_id, term, academic_year_id)
);

CREATE INDEX IF NOT EXISTS idx_scores_student ON student_scores(student_id);
CREATE INDEX IF NOT EXISTS idx_scores_subject ON student_scores(subject_id);
CREATE INDEX IF NOT EXISTS idx_scores_class ON student_scores(class_id);
CREATE INDEX IF NOT EXISTS idx_scores_org ON student_scores(organization_id);
CREATE INDEX IF NOT EXISTS idx_scores_year_term ON student_scores(academic_year_id, term);

-- ==========================================================
-- 4. RLS POLICIES
-- ==========================================================
ALTER TABLE assessment_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE grading_scales ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_scores ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='assessment_types' AND policyname='asstypes_read') THEN
    CREATE POLICY "asstypes_read" ON assessment_types FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='assessment_types' AND policyname='asstypes_write') THEN
    CREATE POLICY "asstypes_write" ON assessment_types FOR ALL USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='grading_scales' AND policyname='grades_read') THEN
    CREATE POLICY "grades_read" ON grading_scales FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='grading_scales' AND policyname='grades_write') THEN
    CREATE POLICY "grades_write" ON grading_scales FOR ALL USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='student_scores' AND policyname='scores_read') THEN
    CREATE POLICY "scores_read" ON student_scores FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='student_scores' AND policyname='scores_write') THEN
    CREATE POLICY "scores_write" ON student_scores FOR ALL USING (true);
  END IF;
END $$;
