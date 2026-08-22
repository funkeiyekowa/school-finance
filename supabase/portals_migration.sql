-- ============================================================
-- PORTALS — Teacher, Student, Parent support tables
-- Run this in the Supabase SQL editor.
--
-- Creates:
--   1. teacher_assignments — links users (teachers) to classes + subjects
--   2. parent_students — links parent user accounts to their children
-- ============================================================

-- ==========================================================
-- 1. TEACHER ASSIGNMENTS — which classes/subjects a teacher handles
-- ==========================================================
CREATE TABLE IF NOT EXISTS teacher_assignments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id uuid REFERENCES subjects(id) ON DELETE SET NULL,  -- NULL = class teacher (all subjects)
  role text NOT NULL DEFAULT 'subject_teacher',  -- 'class_teacher', 'subject_teacher'
  academic_year_id uuid REFERENCES academic_years(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, class_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_teacher_assign_user ON teacher_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_teacher_assign_class ON teacher_assignments(class_id);
CREATE INDEX IF NOT EXISTS idx_teacher_assign_org ON teacher_assignments(organization_id);

-- ==========================================================
-- 2. PARENT-STUDENT LINKS — which students belong to a parent
-- ==========================================================
CREATE TABLE IF NOT EXISTS parent_students (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  parent_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  relationship text DEFAULT 'parent',  -- 'parent', 'guardian', 'sponsor'
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(parent_user_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_parent_students_parent ON parent_students(parent_user_id);
CREATE INDEX IF NOT EXISTS idx_parent_students_student ON parent_students(student_id);
CREATE INDEX IF NOT EXISTS idx_parent_students_org ON parent_students(organization_id);

-- ==========================================================
-- 3. RLS POLICIES
-- ==========================================================
ALTER TABLE teacher_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_students ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='teacher_assignments' AND policyname='ta_read') THEN
    CREATE POLICY "ta_read" ON teacher_assignments FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='teacher_assignments' AND policyname='ta_write') THEN
    CREATE POLICY "ta_write" ON teacher_assignments FOR ALL USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='parent_students' AND policyname='ps_read') THEN
    CREATE POLICY "ps_read" ON parent_students FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='parent_students' AND policyname='ps_write') THEN
    CREATE POLICY "ps_write" ON parent_students FOR ALL USING (true);
  END IF;
END $$;
