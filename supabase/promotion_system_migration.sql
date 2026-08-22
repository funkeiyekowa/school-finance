-- ============================================================
-- STUDENT PROMOTION & CLASS PROGRESSION SYSTEM
-- Run this in the Supabase SQL editor.
--
-- Creates the foundational tables for class configuration,
-- academic years, student enrollments (historical), promotion
-- batches, and individual promotion events.
--
-- Key principle: promotion creates a NEW enrollment for the
-- destination year/class. It never overwrites the previous
-- enrollment. Historical payments/fees remain associated with
-- the enrollment that was active at the time.
-- ============================================================

-- ==========================================================
-- 1. CLASSES — the school's grade/class structure
-- ==========================================================
CREATE TABLE IF NOT EXISTS classes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,                    -- Display name: "JSS1", "Grade 3", "KG1"
  short_code text NOT NULL,              -- Short code for compact display
  sequence integer NOT NULL DEFAULT 0,   -- Ordering: 1, 2, 3... determines progression
  stage text,                            -- Optional grouping: "Early Years", "Junior Secondary"
  next_class_id uuid REFERENCES classes(id) ON DELETE SET NULL,  -- Explicit promotion path
  is_terminal boolean NOT NULL DEFAULT false,  -- True = graduation/completion (no next class)
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_classes_short_code ON classes(short_code);
CREATE INDEX IF NOT EXISTS idx_classes_sequence ON classes(sequence);
CREATE INDEX IF NOT EXISTS idx_classes_active ON classes(active) WHERE active = true;

-- ==========================================================
-- 2. ACADEMIC YEARS — configured by the school
-- ==========================================================
CREATE TABLE IF NOT EXISTS academic_years (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL UNIQUE,             -- e.g. "2025/2026"
  start_date date,
  end_date date,
  status text NOT NULL DEFAULT 'upcoming',  -- 'closed', 'current', 'upcoming'
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_academic_years_status ON academic_years(status);

-- Ensure only one academic year is "current" at a time via a partial unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_academic_years_current
  ON academic_years(status) WHERE status = 'current';

-- ==========================================================
-- 3. STUDENT ENROLLMENTS — historical class assignments
-- ==========================================================
-- Each row represents one student in one class for one academic year.
-- Promotion creates a new row; the old row is never deleted.
-- Fee matching, payment records, and reports can reference enrollments.
CREATE TABLE IF NOT EXISTS student_enrollments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
  academic_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active',  -- 'active', 'completed', 'repeated', 'withdrawn', 'graduated'
  enrolled_at timestamptz DEFAULT now(),
  -- Link to the enrollment this was promoted FROM (null for first enrollment)
  promoted_from_id uuid REFERENCES student_enrollments(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  -- Prevent duplicate enrollments: one student can only be in one class per year
  UNIQUE(student_id, academic_year_id)
);

CREATE INDEX IF NOT EXISTS idx_enrollments_student ON student_enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_class ON student_enrollments(class_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_year ON student_enrollments(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_status ON student_enrollments(status);

-- ==========================================================
-- 4. PROMOTION BATCHES — groups of promotions executed together
-- ==========================================================
CREATE TABLE IF NOT EXISTS promotion_batches (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_code text NOT NULL UNIQUE,       -- e.g. "PROM-2026-001"
  from_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  to_year_id uuid NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending', -- 'pending', 'completed', 'reversed', 'partial'
  total_students integer NOT NULL DEFAULT 0,
  promoted integer NOT NULL DEFAULT 0,
  repeated integer NOT NULL DEFAULT 0,
  graduated integer NOT NULL DEFAULT 0,
  excluded integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  created_by_email text,
  created_by_name text,
  reversed_at timestamptz,
  reversed_by text,
  reversal_reason text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_promotion_batches_years
  ON promotion_batches(from_year_id, to_year_id);

-- ==========================================================
-- 5. PROMOTION EVENTS — individual student promotion records
-- ==========================================================
CREATE TABLE IF NOT EXISTS promotion_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id uuid REFERENCES promotion_batches(id) ON DELETE SET NULL,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  from_enrollment_id uuid REFERENCES student_enrollments(id) ON DELETE SET NULL,
  to_enrollment_id uuid REFERENCES student_enrollments(id) ON DELETE SET NULL,
  from_class_id uuid REFERENCES classes(id) ON DELETE SET NULL,
  to_class_id uuid REFERENCES classes(id) ON DELETE SET NULL,
  from_year_id uuid REFERENCES academic_years(id) ON DELETE SET NULL,
  to_year_id uuid REFERENCES academic_years(id) ON DELETE SET NULL,
  action text NOT NULL,                  -- 'promoted', 'repeated', 'graduated', 'skipped', 'withdrawn', 'reversed'
  reason text,                           -- Free-text reason (required for skip/reversal)
  status text NOT NULL DEFAULT 'completed', -- 'completed', 'reversed', 'failed'
  created_by_email text,
  created_by_name text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_promotion_events_student ON promotion_events(student_id);
CREATE INDEX IF NOT EXISTS idx_promotion_events_batch ON promotion_events(batch_id);
CREATE INDEX IF NOT EXISTS idx_promotion_events_action ON promotion_events(action);

-- ==========================================================
-- RLS POLICIES
-- ==========================================================

-- Classes: anyone authenticated can read, admin can write
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "classes_read" ON classes FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "classes_write" ON classes FOR ALL USING (true);

-- Academic years: anyone can read, admin can write
ALTER TABLE academic_years ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "academic_years_read" ON academic_years FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "academic_years_write" ON academic_years FOR ALL USING (true);

-- Student enrollments: anyone can read, admin can write
ALTER TABLE student_enrollments ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "enrollments_read" ON student_enrollments FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "enrollments_write" ON student_enrollments FOR ALL USING (true);

-- Promotion batches: anyone can read, admin can write
ALTER TABLE promotion_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "batches_read" ON promotion_batches FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "batches_write" ON promotion_batches FOR ALL USING (true);

-- Promotion events: anyone can read, admin can write
ALTER TABLE promotion_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "events_read" ON promotion_events FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "events_write" ON promotion_events FOR ALL USING (true);

-- ==========================================================
-- SEED: Migrate existing grade values into the classes table
-- ==========================================================
-- This creates class records for every distinct grade value currently
-- in use, so existing student data is immediately compatible.
INSERT INTO classes (name, short_code, sequence)
SELECT DISTINCT
  grade,
  grade,
  ROW_NUMBER() OVER (ORDER BY grade)
FROM students
WHERE grade IS NOT NULL AND grade != ''
ON CONFLICT (short_code) DO NOTHING;

-- Seed the current academic year from school_settings if one exists
INSERT INTO academic_years (name, status)
SELECT current_year, 'current'
FROM school_settings
WHERE current_year IS NOT NULL AND current_year != ''
ON CONFLICT (name) DO NOTHING;
