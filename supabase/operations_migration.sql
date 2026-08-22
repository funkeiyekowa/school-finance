-- ============================================================
-- OPERATIONS — HR/Staff, Inventory, Communication
-- Run this in the Supabase SQL editor.
--
-- Creates:
--   1. departments — organizational units
--   2. staff_members — staff directory (teaching + non-teaching)
--   3. inventory_items — stock items with current quantity
--   4. stock_movements — stock in/out audit trail
--   5. announcements — targeted messages to groups
-- ============================================================

-- ==========================================================
-- 1. DEPARTMENTS
-- ==========================================================
CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  head_name text,
  description text,
  active boolean NOT NULL DEFAULT true,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_departments_org ON departments(organization_id);

-- ==========================================================
-- 2. STAFF MEMBERS
-- ==========================================================
CREATE TABLE IF NOT EXISTS staff_members (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_code text NOT NULL,
  full_name text NOT NULL,
  email text,
  phone text,
  gender text,
  date_of_birth date,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  job_title text,
  staff_type text NOT NULL DEFAULT 'teaching',  -- 'teaching', 'non_teaching', 'admin'
  employment_type text DEFAULT 'full_time',      -- 'full_time', 'part_time', 'contract'
  date_joined date,
  qualification text,
  address text,
  emergency_contact text,
  emergency_phone text,
  salary numeric(12,2),
  bank_name text,
  account_number text,
  status text NOT NULL DEFAULT 'active',  -- 'active', 'on_leave', 'resigned', 'terminated'
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,  -- Link to app user account
  notes text,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_org ON staff_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_staff_dept ON staff_members(department_id);
CREATE INDEX IF NOT EXISTS idx_staff_status ON staff_members(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_code_org ON staff_members(staff_code, organization_id);

-- ==========================================================
-- 3. INVENTORY ITEMS
-- ==========================================================
CREATE TABLE IF NOT EXISTS inventory_items (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  item_code text,
  category text,
  unit text DEFAULT 'pcs',               -- 'pcs', 'kg', 'liters', 'boxes', 'reams'
  quantity_on_hand numeric(10,2) NOT NULL DEFAULT 0,
  reorder_level numeric(10,2) DEFAULT 0,
  unit_cost numeric(12,2),
  location text,                         -- Store/room location
  supplier text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_org ON inventory_items(organization_id);
CREATE INDEX IF NOT EXISTS idx_inventory_category ON inventory_items(category);

-- ==========================================================
-- 4. STOCK MOVEMENTS — audit trail for every in/out
-- ==========================================================
CREATE TABLE IF NOT EXISTS stock_movements (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  movement_type text NOT NULL,           -- 'stock_in', 'stock_out', 'adjustment', 'return'
  quantity numeric(10,2) NOT NULL,       -- Positive for in, negative for out
  reference text,                        -- PO number, requisition, etc.
  reason text,
  recorded_by text,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_movements_item ON stock_movements(item_id);
CREATE INDEX IF NOT EXISTS idx_movements_org ON stock_movements(organization_id);

-- ==========================================================
-- 5. ANNOUNCEMENTS
-- ==========================================================
CREATE TABLE IF NOT EXISTS announcements (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  title text NOT NULL,
  body text NOT NULL,
  target text NOT NULL DEFAULT 'all',    -- 'all', 'staff', 'parents', 'students', 'class'
  target_class_id uuid REFERENCES classes(id) ON DELETE SET NULL,  -- When target='class'
  priority text DEFAULT 'normal',        -- 'low', 'normal', 'high', 'urgent'
  published boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  expires_at timestamptz,
  created_by text,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_announcements_org ON announcements(organization_id);
CREATE INDEX IF NOT EXISTS idx_announcements_target ON announcements(target);

-- ==========================================================
-- 6. RLS POLICIES
-- ==========================================================
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='departments' AND policyname='dept_read') THEN
    CREATE POLICY "dept_read" ON departments FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='departments' AND policyname='dept_write') THEN
    CREATE POLICY "dept_write" ON departments FOR ALL USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='staff_members' AND policyname='staff_read') THEN
    CREATE POLICY "staff_read" ON staff_members FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='staff_members' AND policyname='staff_write') THEN
    CREATE POLICY "staff_write" ON staff_members FOR ALL USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='inventory_items' AND policyname='inv_read') THEN
    CREATE POLICY "inv_read" ON inventory_items FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='inventory_items' AND policyname='inv_write') THEN
    CREATE POLICY "inv_write" ON inventory_items FOR ALL USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='stock_movements' AND policyname='sm_read') THEN
    CREATE POLICY "sm_read" ON stock_movements FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='stock_movements' AND policyname='sm_write') THEN
    CREATE POLICY "sm_write" ON stock_movements FOR ALL USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='announcements' AND policyname='ann_read') THEN
    CREATE POLICY "ann_read" ON announcements FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='announcements' AND policyname='ann_write') THEN
    CREATE POLICY "ann_write" ON announcements FOR ALL USING (true);
  END IF;
END $$;
