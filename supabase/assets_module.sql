-- =====================================================================
-- ASSET MANAGEMENT MODULE
-- =====================================================================
-- Adds real functionality behind the "Asset Management" module row in
-- the Platform Admin > Module Catalogue (key='assets'), which
-- previously had zero dashboard pages built for it.
--
-- Scope: a fixed-asset register (equipment, furniture, vehicles,
-- buildings -- anything the school owns and tracks individually,
-- as opposed to inventory_items which is consumable/stock supplies),
-- straight-line depreciation computed on read (never a stored,
-- staleness-prone column), an assignment/location history per asset
-- (who has it / where it lives, over time), a maintenance/repair log,
-- and disposal (write-off / sale) tracking.
--
-- Distinct from inventory_items (operations_migration.sql): inventory
-- is consumable stock tracked by quantity_on_hand (reams of paper,
-- boxes of chalk); assets are individually-identified, depreciating,
-- non-consumable property (a specific laptop, a specific bus) that
-- gets assigned to a person/room and tracked across its useful life.
--
-- Conventions followed (see fix_paginated_ambiguous_columns.sql,
-- transport/lms/library/hostel/payroll/procurement module files):
--   * RLS via current_user_org_id() from the start.
--   * Any RPC's RETURNS TABLE column names avoid colliding with bare
--     identifiers used in its body (the 42702 "ambiguous column" bug).
--   * organization_id has no DB-side default -- every INSERT from the
--     client must set it explicitly. Server-side RPCs set it via v_org.
--
-- Run order: after saas_foundation.sql / multi_tenant_migration.sql
-- (current_user_org_id()), operations_migration.sql (staff_members,
-- departments), and schema.sql (vendors).
--
-- SAFE TO RE-RUN.
-- =====================================================================

-- ==========================================================
-- 1. ASSETS -- the fixed-asset register
-- ==========================================================
CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  asset_code text NOT NULL,                     -- e.g. AST-0001, unique per org
  name text NOT NULL,
  category text,                                 -- free-text, e.g. 'IT Equipment', 'Furniture', 'Vehicle', 'Building'
  serial_number text,
  vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL,
  purchase_date date,
  purchase_cost numeric(14,2) NOT NULL DEFAULT 0,
  salvage_value numeric(14,2) NOT NULL DEFAULT 0,       -- estimated residual value at end of useful life
  useful_life_years numeric(5,2) NOT NULL DEFAULT 5,    -- for straight-line depreciation
  depreciation_method text NOT NULL DEFAULT 'straight_line', -- 'straight_line', 'none' (e.g. land, which doesn't depreciate)
  status text NOT NULL DEFAULT 'in_use',        -- 'in_use', 'in_storage', 'under_repair', 'disposed'
  current_location text,                        -- free-text, e.g. 'Staff Room 2', 'Science Lab'
  assigned_staff_id uuid REFERENCES staff_members(id) ON DELETE SET NULL, -- current custodian, denormalized for fast lookup
                                                                            -- (full history lives in asset_assignments)
  notes text,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(organization_id, asset_code)
);

CREATE INDEX IF NOT EXISTS idx_assets_org_status ON assets(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_assets_org_category ON assets(organization_id, category);
CREATE INDEX IF NOT EXISTS idx_assets_assigned_staff ON assets(assigned_staff_id);

-- ==========================================================
-- 2. ASSIGNMENT HISTORY -- who has it / where it lives, over time
-- ==========================================================
CREATE TABLE IF NOT EXISTS asset_assignments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES staff_members(id) ON DELETE SET NULL,   -- nullable: a location-only assignment (e.g. "moved to Library") need not name a custodian
  location text,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  returned_at timestamptz,                       -- null while this is the CURRENT assignment
  notes text,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_asset_assignments_asset ON asset_assignments(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_assignments_org ON asset_assignments(organization_id);
-- Only one open (returned_at IS NULL) assignment per asset at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_assignment_open ON asset_assignments(asset_id) WHERE returned_at IS NULL;

-- ==========================================================
-- 3. MAINTENANCE LOG -- repairs, servicing, inspections
-- ==========================================================
CREATE TABLE IF NOT EXISTS asset_maintenance (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  maintenance_type text NOT NULL DEFAULT 'repair',  -- 'repair', 'service', 'inspection'
  description text NOT NULL,
  cost numeric(12,2) NOT NULL DEFAULT 0,
  performed_by text,                              -- free-text: in-house staff name or an external vendor/technician
  status text NOT NULL DEFAULT 'completed',       -- 'scheduled', 'in_progress', 'completed'
  scheduled_date date,
  completed_date date,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_maintenance_asset ON asset_maintenance(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_maintenance_org_status ON asset_maintenance(organization_id, status);

-- ==========================================================
-- 4. DISPOSALS -- write-off / sale, ends an asset's active life
-- ==========================================================
CREATE TABLE IF NOT EXISTS asset_disposals (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  disposal_type text NOT NULL DEFAULT 'written_off', -- 'sold', 'written_off', 'donated', 'scrapped'
  disposal_date date NOT NULL DEFAULT CURRENT_DATE,
  proceeds numeric(12,2) NOT NULL DEFAULT 0,      -- sale proceeds, if any (0 for a write-off)
  reason text,
  approved_by_staff_id uuid REFERENCES staff_members(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(asset_id)  -- an asset can only be disposed of once
);

CREATE INDEX IF NOT EXISTS idx_asset_disposals_org ON asset_disposals(organization_id);

-- ==========================================================
-- 5. RLS -- tenant-isolated from the start via current_user_org_id()
-- ==========================================================
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_maintenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_disposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_assets_all ON assets;
CREATE POLICY tenant_assets_all ON assets FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_asset_assignments_all ON asset_assignments;
CREATE POLICY tenant_asset_assignments_all ON asset_assignments FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_asset_maintenance_all ON asset_maintenance;
CREATE POLICY tenant_asset_maintenance_all ON asset_maintenance FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_asset_disposals_all ON asset_disposals;
CREATE POLICY tenant_asset_disposals_all ON asset_disposals FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- ==========================================================
-- 6. DEPRECIATION HELPER -- straight-line, computed on read
-- ==========================================================
-- Deliberately NOT a stored column: a stored "current_value" would go
-- stale the moment time passes without a row update, and would need a
-- daily cron job to stay correct. Straight-line depreciation is cheap
-- to compute on the fly from purchase_date/cost/salvage/useful_life,
-- so every RPC below derives it fresh instead.
--
-- Formula: monthly_depreciation = (cost - salvage) / (useful_life_years * 12)
-- accumulated = monthly_depreciation * months_elapsed, capped at (cost - salvage)
-- book_value = cost - accumulated
CREATE OR REPLACE FUNCTION asset_book_value(
  p_cost numeric, p_salvage numeric, p_useful_life_years numeric,
  p_purchase_date date, p_method text, p_as_of date DEFAULT CURRENT_DATE
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_months numeric;
  v_monthly numeric;
  v_accumulated numeric;
BEGIN
  IF p_method = 'none' OR p_purchase_date IS NULL OR p_useful_life_years IS NULL OR p_useful_life_years <= 0 THEN
    RETURN p_cost;
  END IF;

  v_months := GREATEST(0, (EXTRACT(YEAR FROM age(p_as_of, p_purchase_date)) * 12 + EXTRACT(MONTH FROM age(p_as_of, p_purchase_date))));
  v_monthly := (p_cost - p_salvage) / (p_useful_life_years * 12);
  v_accumulated := LEAST(v_monthly * v_months, GREATEST(p_cost - p_salvage, 0));

  RETURN GREATEST(p_cost - v_accumulated, p_salvage);
END $$;

-- ==========================================================
-- 7. STATS RPC -- fast counts + valuation for the dashboard tiles
-- ==========================================================
CREATE OR REPLACE FUNCTION assets_stats()
RETURNS TABLE (
  total_assets bigint,
  in_use_assets bigint,
  under_repair_assets bigint,
  disposed_assets bigint,
  total_purchase_cost numeric,
  total_book_value numeric,
  open_maintenance bigint
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
    (SELECT COUNT(*) FROM assets a WHERE a.organization_id = v_org AND a.status <> 'disposed') as total_assets,
    (SELECT COUNT(*) FROM assets a WHERE a.organization_id = v_org AND a.status = 'in_use') as in_use_assets,
    (SELECT COUNT(*) FROM assets a WHERE a.organization_id = v_org AND a.status = 'under_repair') as under_repair_assets,
    (SELECT COUNT(*) FROM assets a WHERE a.organization_id = v_org AND a.status = 'disposed') as disposed_assets,
    (SELECT COALESCE(SUM(a.purchase_cost), 0) FROM assets a WHERE a.organization_id = v_org AND a.status <> 'disposed') as total_purchase_cost,
    (SELECT COALESCE(SUM(asset_book_value(a.purchase_cost, a.salvage_value, a.useful_life_years, a.purchase_date, a.depreciation_method)), 0)
       FROM assets a WHERE a.organization_id = v_org AND a.status <> 'disposed') as total_book_value,
    (SELECT COUNT(*) FROM asset_maintenance m WHERE m.organization_id = v_org AND m.status IN ('scheduled','in_progress')) as open_maintenance;
END $$;

GRANT EXECUTE ON FUNCTION assets_stats() TO authenticated;

-- ==========================================================
-- 8. LIST-WITH-BOOK-VALUE RPC -- avoids computing depreciation client-side
-- ==========================================================
-- Returns every non-disposed asset with its computed book value and
-- accumulated depreciation, so the dashboard never has to reimplement
-- the depreciation formula in TypeScript (and risk it drifting from
-- the DB's version).
CREATE OR REPLACE FUNCTION assets_with_book_value()
RETURNS TABLE (
  id uuid, asset_code text, name text, category text, status text,
  purchase_cost numeric, book_value numeric, accumulated_depreciation numeric
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
    a.id, a.asset_code, a.name, a.category, a.status,
    a.purchase_cost,
    asset_book_value(a.purchase_cost, a.salvage_value, a.useful_life_years, a.purchase_date, a.depreciation_method) as book_value,
    a.purchase_cost - asset_book_value(a.purchase_cost, a.salvage_value, a.useful_life_years, a.purchase_date, a.depreciation_method) as accumulated_depreciation
  FROM assets a
  WHERE a.organization_id = v_org
  ORDER BY a.asset_code;
END $$;

GRANT EXECUTE ON FUNCTION assets_with_book_value() TO authenticated;

-- ==========================================================
-- 9. ASSIGN RPC -- closes any open assignment, opens a new one
-- ==========================================================
-- Doing this server-side (rather than two client writes) keeps the
-- "only one open assignment per asset" invariant safe under
-- concurrent edits, and keeps assets.assigned_staff_id /
-- assets.current_location (the denormalized "current" fields used for
-- fast list-page display) in sync with the assignment history in one
-- transaction.
CREATE OR REPLACE FUNCTION asset_assign(
  p_asset_id uuid,
  p_staff_id uuid DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_asset_exists boolean;
  v_new_id uuid;
BEGIN
  SELECT EXISTS(SELECT 1 FROM assets a WHERE a.id = p_asset_id AND a.organization_id = v_org) INTO v_asset_exists;
  IF NOT v_asset_exists THEN
    RAISE EXCEPTION 'Asset not found in this organization';
  END IF;

  UPDATE asset_assignments SET returned_at = now()
  WHERE asset_id = p_asset_id AND returned_at IS NULL;

  INSERT INTO asset_assignments (asset_id, staff_id, location, notes, organization_id)
  VALUES (p_asset_id, p_staff_id, p_location, p_notes, v_org)
  RETURNING id INTO v_new_id;

  UPDATE assets SET assigned_staff_id = p_staff_id, current_location = p_location, updated_at = now()
  WHERE id = p_asset_id;

  RETURN v_new_id;
END $$;

GRANT EXECUTE ON FUNCTION asset_assign(uuid, uuid, text, text) TO authenticated;

-- ==========================================================
-- 10. DISPOSE RPC -- ends an asset's active life
-- ==========================================================
CREATE OR REPLACE FUNCTION asset_dispose(
  p_asset_id uuid,
  p_disposal_type text,
  p_proceeds numeric DEFAULT 0,
  p_reason text DEFAULT NULL,
  p_approved_by_staff_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_status text;
BEGIN
  SELECT a.status INTO v_status FROM assets a WHERE a.id = p_asset_id AND a.organization_id = v_org FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Asset not found in this organization';
  END IF;
  IF v_status = 'disposed' THEN
    RAISE EXCEPTION 'Asset is already disposed';
  END IF;

  INSERT INTO asset_disposals (asset_id, disposal_type, proceeds, reason, approved_by_staff_id, organization_id)
  VALUES (p_asset_id, p_disposal_type, p_proceeds, p_reason, p_approved_by_staff_id, v_org);

  UPDATE asset_assignments SET returned_at = now() WHERE asset_id = p_asset_id AND returned_at IS NULL;
  UPDATE assets SET status = 'disposed', updated_at = now() WHERE id = p_asset_id;
END $$;

GRANT EXECUTE ON FUNCTION asset_dispose(uuid, text, numeric, text, uuid) TO authenticated;
