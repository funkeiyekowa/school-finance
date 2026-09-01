-- =====================================================================
-- TRANSPORT MODULE
-- =====================================================================
-- Adds real functionality behind the "Transport" module row in the
-- Platform Admin > Module Catalogue, which previously had zero
-- dashboard pages built for it.
--
-- Three tables:
--   transport_vehicles       -- the bus/van fleet
--   transport_routes         -- named routes, each optionally assigned a vehicle + driver
--   transport_student_assignments -- which students ride which route (+ pickup point, fee)
--
-- RLS is written correctly the first time via current_user_org_id() --
-- NOT the old "USING (true)" pattern used in operations_migration.sql,
-- which had to be patched later in tenant_isolation_full.sql. Run order:
-- after saas_foundation.sql / multi_tenant_migration.sql (needs
-- current_user_org_id()) and operations_migration.sql (needs
-- staff_members for driver assignment) and students/schema (needs
-- students for rider assignment).
--
-- SAFE TO RE-RUN.
-- =====================================================================

-- ==========================================================
-- 1. VEHICLES
-- ==========================================================
CREATE TABLE IF NOT EXISTS transport_vehicles (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_code text NOT NULL,             -- e.g. "BUS-01"
  plate_number text,
  make_model text,
  capacity integer,                       -- seat count
  vehicle_type text NOT NULL DEFAULT 'bus', -- 'bus', 'van', 'car'
  status text NOT NULL DEFAULT 'active',  -- 'active', 'maintenance', 'retired'
  driver_staff_id uuid REFERENCES staff_members(id) ON DELETE SET NULL,
  driver_name text,                       -- fallback when driver isn't a staff record
  driver_phone text,
  insurance_expiry date,
  roadworthiness_expiry date,
  notes text,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(organization_id, vehicle_code)
);

CREATE INDEX IF NOT EXISTS idx_transport_vehicles_org ON transport_vehicles(organization_id);
CREATE INDEX IF NOT EXISTS idx_transport_vehicles_status ON transport_vehicles(organization_id, status);

-- ==========================================================
-- 2. ROUTES
-- ==========================================================
CREATE TABLE IF NOT EXISTS transport_routes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  route_code text NOT NULL,               -- e.g. "RT-01"
  name text NOT NULL,                     -- e.g. "Lekki - Ajah Route"
  description text,
  vehicle_id uuid REFERENCES transport_vehicles(id) ON DELETE SET NULL,
  departure_time time,
  return_time time,
  fee_per_term numeric(12,2),
  status text NOT NULL DEFAULT 'active',  -- 'active', 'suspended'
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(organization_id, route_code)
);

CREATE INDEX IF NOT EXISTS idx_transport_routes_org ON transport_routes(organization_id);
CREATE INDEX IF NOT EXISTS idx_transport_routes_vehicle ON transport_routes(vehicle_id);

-- ==========================================================
-- 3. STUDENT ASSIGNMENTS
-- ==========================================================
CREATE TABLE IF NOT EXISTS transport_student_assignments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  route_id uuid NOT NULL REFERENCES transport_routes(id) ON DELETE CASCADE,
  pickup_point text,
  drop_off_point text,
  status text NOT NULL DEFAULT 'active',  -- 'active', 'inactive'
  start_date date DEFAULT CURRENT_DATE,
  end_date date,
  notes text,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(student_id, route_id)
);

CREATE INDEX IF NOT EXISTS idx_transport_assign_org ON transport_student_assignments(organization_id);
CREATE INDEX IF NOT EXISTS idx_transport_assign_student ON transport_student_assignments(student_id);
CREATE INDEX IF NOT EXISTS idx_transport_assign_route ON transport_student_assignments(route_id);

-- ==========================================================
-- 4. RLS -- tenant-isolated from the start via current_user_org_id()
-- ==========================================================
ALTER TABLE transport_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE transport_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE transport_student_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_transport_vehicles_all ON transport_vehicles;
CREATE POLICY tenant_transport_vehicles_all ON transport_vehicles FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_transport_routes_all ON transport_routes;
CREATE POLICY tenant_transport_routes_all ON transport_routes FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_transport_assignments_all ON transport_student_assignments;
CREATE POLICY tenant_transport_assignments_all ON transport_student_assignments FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- ==========================================================
-- 5. STATS RPC -- fast counts for the dashboard tiles
-- ==========================================================
-- Column names avoid colliding with any bare identifier referenced in
-- the function body (learned the hard way from students_paginated /
-- staff_paginated -- see fix_paginated_ambiguous_columns.sql).
CREATE OR REPLACE FUNCTION transport_stats()
RETURNS TABLE (
  total_vehicles bigint,
  active_vehicles bigint,
  total_routes bigint,
  total_riders bigint
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
    (SELECT COUNT(*) FROM transport_vehicles WHERE organization_id = v_org) as total_vehicles,
    (SELECT COUNT(*) FROM transport_vehicles WHERE organization_id = v_org AND status = 'active') as active_vehicles,
    (SELECT COUNT(*) FROM transport_routes WHERE organization_id = v_org AND status = 'active') as total_routes,
    (SELECT COUNT(*) FROM transport_student_assignments WHERE organization_id = v_org AND status = 'active') as total_riders;
END $$;

GRANT EXECUTE ON FUNCTION transport_stats() TO authenticated;

-- ==========================================================
-- 6. REGISTER MODULE ENTITLEMENT DEFAULT
-- ==========================================================
-- Module row already exists in platform_modules (key='transport',
-- seeded in saas_foundation.sql) -- nothing to add there. This just
-- documents that a school must have an active `transport` row in
-- the `subscriptions` table (organization_id, module_key='transport',
-- status='active') for hasModule("transport") to return true and the
-- sidebar link / pages to be reachable. Grant it per school from
-- Platform Admin, or directly:
--   INSERT INTO subscriptions (organization_id, module_key, status)
--   VALUES ('<org-id>', 'transport', 'active')
--   ON CONFLICT (organization_id, module_key) DO UPDATE SET status = 'active';
