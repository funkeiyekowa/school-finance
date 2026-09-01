-- =====================================================================
-- HOSTEL / BOARDING MODULE
-- =====================================================================
-- Adds real functionality behind the "Hostel / Boarding" module row in
-- the Platform Admin > Module Catalogue (key='hostel'), which
-- previously had zero dashboard pages built for it.
--
-- Scope: hostels (boarding houses) -> rooms -> beds, student
-- allocation to a specific bed for a term/session, a visitor sign-
-- in/out log (a boarding house's front desk needs this whether or not
-- it's tied to a specific student visit), and an incident/inspection
-- log for house-parent write-ups (damage, curfew, health, room
-- inspection results).
--
-- Conventions followed (see fix_paginated_ambiguous_columns.sql,
-- transport_module.sql, lms_module.sql, library_module.sql):
--   * RLS via current_user_org_id() from the start, never "USING (true)".
--   * Any RPC's RETURNS TABLE column names avoid colliding with bare
--     identifiers used in its body (the 42702 "ambiguous column" bug)
--     -- every table-column reference in a function body is qualified
--     with a table alias.
--   * organization_id has no DB-side default -- every INSERT from the
--     client must set it explicitly (see the LMS RLS-violation fix,
--     commit 9b0ec3f). This file's allocation RPC sets it via v_org so
--     that server-side write can't get it wrong either.
--
-- Run order: after saas_foundation.sql / multi_tenant_migration.sql
-- (current_user_org_id()), operations_migration.sql (staff_members),
-- and the students table.
--
-- SAFE TO RE-RUN.
-- =====================================================================

-- ==========================================================
-- 1. HOSTELS (boarding houses)
-- ==========================================================
CREATE TABLE IF NOT EXISTS hostel_houses (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  gender text NOT NULL DEFAULT 'mixed',        -- 'male', 'female', 'mixed'
  house_parent_staff_id uuid REFERENCES staff_members(id) ON DELETE SET NULL,
  capacity integer,                            -- optional stated capacity; actual capacity is derived from beds
  description text,
  status text NOT NULL DEFAULT 'active',       -- 'active', 'closed'
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hostel_houses_org ON hostel_houses(organization_id);

-- ==========================================================
-- 2. ROOMS
-- ==========================================================
CREATE TABLE IF NOT EXISTS hostel_rooms (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  house_id uuid NOT NULL REFERENCES hostel_houses(id) ON DELETE CASCADE,
  room_number text NOT NULL,
  floor_level text,
  status text NOT NULL DEFAULT 'active',       -- 'active', 'maintenance', 'closed'
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(house_id, room_number)
);

CREATE INDEX IF NOT EXISTS idx_hostel_rooms_house ON hostel_rooms(house_id);
CREATE INDEX IF NOT EXISTS idx_hostel_rooms_org ON hostel_rooms(organization_id);

-- ==========================================================
-- 3. BEDS -- the actual allocatable unit
-- ==========================================================
CREATE TABLE IF NOT EXISTS hostel_beds (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id uuid NOT NULL REFERENCES hostel_rooms(id) ON DELETE CASCADE,
  bed_label text NOT NULL DEFAULT 'A',         -- e.g. 'A', 'B', 'Upper', 'Lower'
  status text NOT NULL DEFAULT 'available',    -- 'available', 'occupied', 'maintenance'
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(room_id, bed_label)
);

CREATE INDEX IF NOT EXISTS idx_hostel_beds_room ON hostel_beds(room_id);
CREATE INDEX IF NOT EXISTS idx_hostel_beds_org_status ON hostel_beds(organization_id, status);

-- ==========================================================
-- 4. ALLOCATIONS -- a student's assignment to a bed for a period
-- ==========================================================
CREATE TABLE IF NOT EXISTS hostel_allocations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  bed_id uuid NOT NULL REFERENCES hostel_beds(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  academic_year text,
  status text NOT NULL DEFAULT 'active',       -- 'active', 'checked_out'
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  checked_out_at timestamptz,
  notes text,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_hostel_alloc_bed ON hostel_allocations(bed_id);
CREATE INDEX IF NOT EXISTS idx_hostel_alloc_student ON hostel_allocations(student_id);
CREATE INDEX IF NOT EXISTS idx_hostel_alloc_org_status ON hostel_allocations(organization_id, status);
-- A student can only have one ACTIVE allocation at a time; enforced by
-- a partial unique index rather than a plain UNIQUE constraint so past
-- (checked_out) allocations for the same student don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS uq_hostel_alloc_active_student ON hostel_allocations(student_id) WHERE status = 'active';

-- ==========================================================
-- 5. VISITOR LOG -- front-desk sign-in/out, optionally tied to a student
-- ==========================================================
CREATE TABLE IF NOT EXISTS hostel_visitor_log (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  house_id uuid NOT NULL REFERENCES hostel_houses(id) ON DELETE CASCADE,
  visitor_name text NOT NULL,
  visitor_phone text,
  relationship text,                            -- e.g. 'Parent', 'Guardian', 'Sibling', 'Vendor'
  student_id uuid REFERENCES students(id) ON DELETE SET NULL, -- who they're visiting, if applicable
  purpose text,
  signed_in_at timestamptz NOT NULL DEFAULT now(),
  signed_out_at timestamptz,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_hostel_visitor_house ON hostel_visitor_log(house_id);
CREATE INDEX IF NOT EXISTS idx_hostel_visitor_org ON hostel_visitor_log(organization_id, signed_in_at);

-- ==========================================================
-- 6. INCIDENT / INSPECTION LOG -- house-parent write-ups
-- ==========================================================
CREATE TABLE IF NOT EXISTS hostel_incidents (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  house_id uuid NOT NULL REFERENCES hostel_houses(id) ON DELETE CASCADE,
  room_id uuid REFERENCES hostel_rooms(id) ON DELETE SET NULL,
  student_id uuid REFERENCES students(id) ON DELETE SET NULL,   -- nullable: a room-inspection entry may not name one student
  category text NOT NULL DEFAULT 'other',       -- 'curfew', 'damage', 'health', 'discipline', 'inspection', 'other'
  severity text NOT NULL DEFAULT 'low',         -- 'low', 'medium', 'high'
  description text NOT NULL,
  status text NOT NULL DEFAULT 'open',          -- 'open', 'resolved'
  reported_by_staff_id uuid REFERENCES staff_members(id) ON DELETE SET NULL,
  resolution_notes text,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_hostel_incidents_house ON hostel_incidents(house_id);
CREATE INDEX IF NOT EXISTS idx_hostel_incidents_org_status ON hostel_incidents(organization_id, status);

-- ==========================================================
-- 7. RLS -- tenant-isolated from the start via current_user_org_id()
-- ==========================================================
ALTER TABLE hostel_houses ENABLE ROW LEVEL SECURITY;
ALTER TABLE hostel_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE hostel_beds ENABLE ROW LEVEL SECURITY;
ALTER TABLE hostel_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE hostel_visitor_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE hostel_incidents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_hostel_houses_all ON hostel_houses;
CREATE POLICY tenant_hostel_houses_all ON hostel_houses FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_hostel_rooms_all ON hostel_rooms;
CREATE POLICY tenant_hostel_rooms_all ON hostel_rooms FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_hostel_beds_all ON hostel_beds;
CREATE POLICY tenant_hostel_beds_all ON hostel_beds FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_hostel_alloc_all ON hostel_allocations;
CREATE POLICY tenant_hostel_alloc_all ON hostel_allocations FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_hostel_visitor_all ON hostel_visitor_log;
CREATE POLICY tenant_hostel_visitor_all ON hostel_visitor_log FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_hostel_incidents_all ON hostel_incidents;
CREATE POLICY tenant_hostel_incidents_all ON hostel_incidents FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- ==========================================================
-- 8. STATS RPC -- fast counts for the dashboard tiles
-- ==========================================================
CREATE OR REPLACE FUNCTION hostel_stats()
RETURNS TABLE (
  total_houses bigint,
  total_beds bigint,
  occupied_beds bigint,
  available_beds bigint,
  open_incidents bigint,
  visitors_on_site bigint
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
    (SELECT COUNT(*) FROM hostel_houses h WHERE h.organization_id = v_org AND h.status = 'active') as total_houses,
    (SELECT COUNT(*) FROM hostel_beds b WHERE b.organization_id = v_org AND b.status <> 'maintenance') as total_beds,
    (SELECT COUNT(*) FROM hostel_beds b WHERE b.organization_id = v_org AND b.status = 'occupied') as occupied_beds,
    (SELECT COUNT(*) FROM hostel_beds b WHERE b.organization_id = v_org AND b.status = 'available') as available_beds,
    (SELECT COUNT(*) FROM hostel_incidents i WHERE i.organization_id = v_org AND i.status = 'open') as open_incidents,
    (SELECT COUNT(*) FROM hostel_visitor_log v WHERE v.organization_id = v_org AND v.signed_out_at IS NULL) as visitors_on_site;
END $$;

GRANT EXECUTE ON FUNCTION hostel_stats() TO authenticated;

-- ==========================================================
-- 9. ALLOCATE-BED RPC -- atomically assigns a student to a bed
-- ==========================================================
-- Doing this server-side (rather than two client writes: insert
-- allocation + update bed status) closes the race where two staff try
-- to allocate the same "available" bed at once, and enforces "one
-- active allocation per student" as a real constraint check rather
-- than trusting the UI to have checked first.
CREATE OR REPLACE FUNCTION hostel_allocate_bed(
  p_bed_id uuid,
  p_student_id uuid,
  p_academic_year text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_bed_status text;
  v_existing_active uuid;
  v_alloc_id uuid;
BEGIN
  SELECT b.status INTO v_bed_status FROM hostel_beds b
  WHERE b.id = p_bed_id AND b.organization_id = v_org
  FOR UPDATE;

  IF v_bed_status IS NULL THEN
    RAISE EXCEPTION 'Bed not found in this organization';
  END IF;
  IF v_bed_status <> 'available' THEN
    RAISE EXCEPTION 'Bed is not available (status: %)', v_bed_status;
  END IF;

  SELECT a.id INTO v_existing_active FROM hostel_allocations a
  WHERE a.student_id = p_student_id AND a.status = 'active' AND a.organization_id = v_org;
  IF v_existing_active IS NOT NULL THEN
    RAISE EXCEPTION 'Student already has an active bed allocation';
  END IF;

  INSERT INTO hostel_allocations (bed_id, student_id, academic_year, organization_id)
  VALUES (p_bed_id, p_student_id, p_academic_year, v_org)
  RETURNING id INTO v_alloc_id;

  UPDATE hostel_beds SET status = 'occupied' WHERE id = p_bed_id;

  RETURN v_alloc_id;
END $$;

GRANT EXECUTE ON FUNCTION hostel_allocate_bed(uuid, uuid, text) TO authenticated;

-- ==========================================================
-- 10. CHECK-OUT RPC -- ends the allocation and frees the bed
-- ==========================================================
CREATE OR REPLACE FUNCTION hostel_checkout_bed(p_allocation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_bed_id uuid;
  v_status text;
BEGIN
  SELECT a.bed_id, a.status INTO v_bed_id, v_status FROM hostel_allocations a
  WHERE a.id = p_allocation_id AND a.organization_id = v_org
  FOR UPDATE;

  IF v_bed_id IS NULL THEN
    RAISE EXCEPTION 'Allocation not found in this organization';
  END IF;
  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'Allocation is already checked out';
  END IF;

  UPDATE hostel_allocations SET status = 'checked_out', checked_out_at = now() WHERE id = p_allocation_id;
  UPDATE hostel_beds SET status = 'available' WHERE id = v_bed_id;
END $$;

GRANT EXECUTE ON FUNCTION hostel_checkout_bed(uuid) TO authenticated;
