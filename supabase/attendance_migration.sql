-- ============================================================
-- ATTENDANCE SYSTEM
-- Run this in the Supabase SQL editor.
--
-- Creates tables for:
--   1. Subjects (reusable across timetable, assessments, attendance)
--   2. Attendance statuses (configurable per school)
--   3. Attendance records (one row per student per date per session)
-- ============================================================

-- ==========================================================
-- 1. SUBJECTS — school's subject catalog
-- ==========================================================
CREATE TABLE IF NOT EXISTS subjects (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  short_code text NOT NULL,
  department text,                    -- e.g. "Sciences", "Arts"
  class_id uuid REFERENCES classes(id) ON DELETE SET NULL,  -- Optional: subject specific to a class
  is_elective boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subjects_org ON subjects(organization_id);
CREATE INDEX IF NOT EXISTS idx_subjects_class ON subjects(class_id);

-- ==========================================================
-- 2. ATTENDANCE STATUSES — configurable per school
-- ==========================================================
CREATE TABLE IF NOT EXISTS attendance_statuses (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  code text NOT NULL,                 -- 'present', 'absent', 'late', 'excused', 'sick'
  label text NOT NULL,                -- Display name
  color text DEFAULT '#6B7280',       -- Badge color for UI
  counts_as_present boolean NOT NULL DEFAULT false,  -- Does this status count toward attendance %?
  is_default boolean NOT NULL DEFAULT false,         -- Pre-selected when opening attendance
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attendance_statuses_org ON attendance_statuses(organization_id);

-- Seed default statuses (will be assigned to existing org via backfill below)
INSERT INTO attendance_statuses (code, label, color, counts_as_present, is_default, sort_order)
VALUES
  ('present', 'Present', '#16A34A', true, true, 1),
  ('absent', 'Absent', '#DC2626', false, false, 2),
  ('late', 'Late', '#D97706', true, false, 3),
  ('excused', 'Excused', '#2563EB', false, false, 4),
  ('sick', 'Sick', '#7C3AED', false, false, 5)
ON CONFLICT DO NOTHING;

-- ==========================================================
-- 3. ATTENDANCE RECORDS — one row per student per date
-- ==========================================================
CREATE TABLE IF NOT EXISTS attendance_records (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id uuid REFERENCES classes(id) ON DELETE SET NULL,
  academic_year_id uuid REFERENCES academic_years(id) ON DELETE SET NULL,
  subject_id uuid REFERENCES subjects(id) ON DELETE SET NULL,  -- NULL = daily/general attendance
  date date NOT NULL,
  status_code text NOT NULL DEFAULT 'present',  -- References attendance_statuses.code
  session text DEFAULT 'morning',               -- 'morning', 'afternoon', 'full_day', or subject-specific
  remarks text,
  recorded_by text,                             -- Who marked it
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  -- One record per student per date per session (prevents duplicates)
  UNIQUE(student_id, date, session, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance_records(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records(date);
CREATE INDEX IF NOT EXISTS idx_attendance_class ON attendance_records(class_id);
CREATE INDEX IF NOT EXISTS idx_attendance_org ON attendance_records(organization_id);
CREATE INDEX IF NOT EXISTS idx_attendance_year ON attendance_records(academic_year_id);

-- ==========================================================
-- 4. RLS POLICIES
-- ==========================================================
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='subjects' AND policyname='subjects_read') THEN
    CREATE POLICY "subjects_read" ON subjects FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='subjects' AND policyname='subjects_write') THEN
    CREATE POLICY "subjects_write" ON subjects FOR ALL USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='attendance_statuses' AND policyname='att_statuses_read') THEN
    CREATE POLICY "att_statuses_read" ON attendance_statuses FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='attendance_statuses' AND policyname='att_statuses_write') THEN
    CREATE POLICY "att_statuses_write" ON attendance_statuses FOR ALL USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='attendance_records' AND policyname='att_records_read') THEN
    CREATE POLICY "att_records_read" ON attendance_records FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='attendance_records' AND policyname='att_records_write') THEN
    CREATE POLICY "att_records_write" ON attendance_records FOR ALL USING (true);
  END IF;
END $$;

-- ==========================================================
-- 5. BACKFILL: assign default statuses to existing org
-- ==========================================================
DO $$
DECLARE
  default_org_id uuid;
BEGIN
  SELECT id INTO default_org_id FROM organizations WHERE slug = 'default' LIMIT 1;
  IF default_org_id IS NOT NULL THEN
    UPDATE attendance_statuses SET organization_id = default_org_id WHERE organization_id IS NULL;
  END IF;
END $$;
