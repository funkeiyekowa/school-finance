-- ============================================================================
-- Report Card, Parent Portal, Student Portal, CBT Enhancements Migration
-- Created: 2026-08-26
-- ============================================================================

-- ------------------------------------------------------------
-- REPORT CARDS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  academic_year_id UUID REFERENCES academic_years(id) ON DELETE SET NULL,
  class_id UUID REFERENCES classes(id) ON DELETE SET NULL,
  term TEXT NOT NULL,
  session_name TEXT,

  -- Aggregates
  total_score NUMERIC(6,2) DEFAULT 0,
  average_score NUMERIC(5,2) DEFAULT 0,
  total_subjects INT DEFAULT 0,
  position_in_class INT,
  class_size INT,
  grade_overall TEXT,
  attendance_present INT DEFAULT 0,
  attendance_total INT DEFAULT 0,

  -- Comments
  teacher_comment TEXT,
  principal_comment TEXT,
  next_term_begins DATE,

  -- Signatures / audit
  published BOOLEAN DEFAULT false,
  published_at TIMESTAMPTZ,
  published_by UUID REFERENCES profiles(id),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organization_id, student_id, academic_year_id, term)
);

CREATE INDEX IF NOT EXISTS idx_report_cards_org ON report_cards(organization_id);
CREATE INDEX IF NOT EXISTS idx_report_cards_student ON report_cards(student_id);
CREATE INDEX IF NOT EXISTS idx_report_cards_year_term ON report_cards(academic_year_id, term);

CREATE TABLE IF NOT EXISTS report_card_subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_card_id UUID NOT NULL REFERENCES report_cards(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  subject_name TEXT NOT NULL,

  ca1_score NUMERIC(5,2),
  ca2_score NUMERIC(5,2),
  ca3_score NUMERIC(5,2),
  exam_score NUMERIC(5,2),
  total_score NUMERIC(5,2),
  grade TEXT,
  remark TEXT,
  teacher_name TEXT,
  position INT,
  class_highest NUMERIC(5,2),
  class_lowest NUMERIC(5,2),
  class_average NUMERIC(5,2),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rcs_report_card ON report_card_subjects(report_card_id);

-- ------------------------------------------------------------
-- PARENT / STUDENT CREDENTIALS + LINKING
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parent_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  occupation TEXT,
  relationship TEXT DEFAULT 'guardian',
  address TEXT,
  notes TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_parent_profiles_org ON parent_profiles(organization_id);
CREATE INDEX IF NOT EXISTS idx_parent_profiles_email ON parent_profiles(email);

CREATE TABLE IF NOT EXISTS parent_student_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parent_id UUID NOT NULL REFERENCES parent_profiles(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  is_primary BOOLEAN DEFAULT false,
  can_view_finance BOOLEAN DEFAULT true,
  can_view_academics BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (parent_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_psl_org ON parent_student_links(organization_id);
CREATE INDEX IF NOT EXISTS idx_psl_parent ON parent_student_links(parent_id);
CREATE INDEX IF NOT EXISTS idx_psl_student ON parent_student_links(student_id);

-- Student login credentials
ALTER TABLE students ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE students ADD COLUMN IF NOT EXISTS login_enabled BOOLEAN DEFAULT false;
ALTER TABLE students ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT true;
ALTER TABLE students ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- ------------------------------------------------------------
-- CBT ENHANCEMENTS: Assignments + Question Types
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cbt_exam_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
  available_from TIMESTAMPTZ,
  available_to TIMESTAMPTZ,
  assigned_by UUID REFERENCES profiles(id),
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  notified BOOLEAN DEFAULT false,
  CHECK (student_id IS NOT NULL OR class_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_cea_org ON cbt_exam_assignments(organization_id);
CREATE INDEX IF NOT EXISTS idx_cea_exam ON cbt_exam_assignments(exam_id);
CREATE INDEX IF NOT EXISTS idx_cea_student ON cbt_exam_assignments(student_id);
CREATE INDEX IF NOT EXISTS idx_cea_class ON cbt_exam_assignments(class_id);

-- Support more question types
DO $$ BEGIN
  ALTER TABLE questions ADD COLUMN IF NOT EXISTS answer_text TEXT;
  ALTER TABLE questions ADD COLUMN IF NOT EXISTS explanation TEXT;
  ALTER TABLE questions ADD COLUMN IF NOT EXISTS case_sensitive BOOLEAN DEFAULT false;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ------------------------------------------------------------
-- RLS POLICIES (organization-scoped)
-- ------------------------------------------------------------
ALTER TABLE report_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_card_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_student_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbt_exam_assignments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY report_cards_org_isolation ON report_cards
    USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY rcs_org_isolation ON report_card_subjects
    USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY parent_profiles_org_isolation ON parent_profiles
    USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY psl_org_isolation ON parent_student_links
    USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY cea_org_isolation ON cbt_exam_assignments
    USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Helper: grade calculator
CREATE OR REPLACE FUNCTION calculate_grade(score NUMERIC)
RETURNS TEXT AS $$
BEGIN
  IF score IS NULL THEN RETURN NULL;
  ELSIF score >= 75 THEN RETURN 'A';
  ELSIF score >= 65 THEN RETURN 'B';
  ELSIF score >= 55 THEN RETURN 'C';
  ELSIF score >= 45 THEN RETURN 'D';
  ELSIF score >= 40 THEN RETURN 'E';
  ELSE RETURN 'F';
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
