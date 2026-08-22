-- ============================================================
-- TIMETABLE SYSTEM
-- Run this in the Supabase SQL editor.
--
-- Creates:
--   1. periods — configurable time slots for the school day
--   2. timetable_entries — class + subject + teacher + period + day
--      with unique constraints preventing double-booking
-- ============================================================

-- ==========================================================
-- 1. PERIODS — school's time slot configuration
-- ==========================================================
CREATE TABLE IF NOT EXISTS periods (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,                    -- "Period 1", "Break", "Assembly"
  short_code text NOT NULL,              -- "P1", "BRK"
  start_time time NOT NULL,              -- 08:00
  end_time time NOT NULL,                -- 08:45
  is_break boolean NOT NULL DEFAULT false,  -- Break/lunch periods (not schedulable)
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_periods_org ON periods(organization_id);

-- Seed default periods for existing org
DO $$
DECLARE
  default_org_id uuid;
BEGIN
  SELECT id INTO default_org_id FROM organizations WHERE slug = 'default' LIMIT 1;
  IF default_org_id IS NOT NULL THEN
    INSERT INTO periods (name, short_code, start_time, end_time, is_break, sort_order, organization_id) VALUES
      ('Period 1', 'P1', '08:00', '08:45', false, 1, default_org_id),
      ('Period 2', 'P2', '08:45', '09:30', false, 2, default_org_id),
      ('Period 3', 'P3', '09:30', '10:15', false, 3, default_org_id),
      ('Break', 'BRK', '10:15', '10:45', true, 4, default_org_id),
      ('Period 4', 'P4', '10:45', '11:30', false, 5, default_org_id),
      ('Period 5', 'P5', '11:30', '12:15', false, 6, default_org_id),
      ('Lunch', 'LUN', '12:15', '13:00', true, 7, default_org_id),
      ('Period 6', 'P6', '13:00', '13:45', false, 8, default_org_id),
      ('Period 7', 'P7', '13:45', '14:30', false, 9, default_org_id)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- ==========================================================
-- 2. TIMETABLE ENTRIES — scheduled lessons
-- ==========================================================
CREATE TABLE IF NOT EXISTS timetable_entries (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  period_id uuid NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
  teacher_name text,                     -- Free-text for now (can be FK to staff table later)
  day_of_week integer NOT NULL,          -- 1=Monday, 2=Tuesday, ... 5=Friday
  room text,                             -- Optional room/venue
  academic_year_id uuid REFERENCES academic_years(id) ON DELETE SET NULL,
  notes text,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  -- CONFLICT PREVENTION:
  -- A class cannot be in two places at the same time
  UNIQUE(class_id, period_id, day_of_week),
  -- A teacher cannot teach two classes at the same time
  -- (enforced at application level since teacher_name is free-text)
  -- A room cannot host two classes at the same time (enforced at app level)
  -- These will become DB constraints when staff/rooms tables are added
  CONSTRAINT valid_day CHECK (day_of_week BETWEEN 1 AND 7)
);

CREATE INDEX IF NOT EXISTS idx_timetable_class ON timetable_entries(class_id);
CREATE INDEX IF NOT EXISTS idx_timetable_day ON timetable_entries(day_of_week);
CREATE INDEX IF NOT EXISTS idx_timetable_org ON timetable_entries(organization_id);
CREATE INDEX IF NOT EXISTS idx_timetable_period ON timetable_entries(period_id);
CREATE INDEX IF NOT EXISTS idx_timetable_teacher ON timetable_entries(teacher_name);

-- ==========================================================
-- 3. RLS POLICIES
-- ==========================================================
ALTER TABLE periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE timetable_entries ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='periods' AND policyname='periods_read') THEN
    CREATE POLICY "periods_read" ON periods FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='periods' AND policyname='periods_write') THEN
    CREATE POLICY "periods_write" ON periods FOR ALL USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='timetable_entries' AND policyname='timetable_read') THEN
    CREATE POLICY "timetable_read" ON timetable_entries FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='timetable_entries' AND policyname='timetable_write') THEN
    CREATE POLICY "timetable_write" ON timetable_entries FOR ALL USING (true);
  END IF;
END $$;
