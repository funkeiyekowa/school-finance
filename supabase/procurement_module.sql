-- =====================================================================
-- PROCUREMENT MODULE
-- =====================================================================
-- Adds real functionality behind the "Procurement" module row in the
-- Platform Admin > Module Catalogue (key='procurement'), which
-- previously had zero dashboard pages built for it.
--
-- Scope: staff-submitted purchase requests (with line items) that go
-- through an approval step, get converted into a purchase order
-- placed with a vendor, and are received against -- optionally
-- crediting matching inventory_items.quantity_on_hand so procurement
-- and inventory stay in sync rather than being two disconnected
-- systems. Vendors and inventory_items already exist (schema.sql /
-- operations_migration.sql) -- this module builds the requisition ->
-- approval -> order -> receipt workflow on top of them.
--
-- Conventions followed (see fix_paginated_ambiguous_columns.sql,
-- transport/lms/library/hostel/payroll module files):
--   * RLS via current_user_org_id() from the start.
--   * Any RPC's RETURNS TABLE column names avoid colliding with bare
--     identifiers used in its body (the 42702 "ambiguous column" bug).
--   * organization_id has no DB-side default -- every INSERT from the
--     client must set it explicitly. Server-side RPCs set it via v_org.
--
-- Run order: after saas_foundation.sql / multi_tenant_migration.sql
-- (current_user_org_id()), operations_migration.sql (staff_members,
-- inventory_items), and schema.sql (vendors).
--
-- SAFE TO RE-RUN.
-- =====================================================================

-- ==========================================================
-- 1. PURCHASE REQUESTS -- a staff member's ask, before approval
-- ==========================================================
CREATE TABLE IF NOT EXISTS procurement_requests (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_code text NOT NULL,                    -- e.g. PR-0001, unique per org
  requested_by_staff_id uuid REFERENCES staff_members(id) ON DELETE SET NULL,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  justification text,
  status text NOT NULL DEFAULT 'pending',        -- 'pending', 'approved', 'rejected', 'ordered'
  reviewed_by_staff_id uuid REFERENCES staff_members(id) ON DELETE SET NULL,
  review_notes text,
  reviewed_at timestamptz,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(organization_id, request_code)
);

CREATE INDEX IF NOT EXISTS idx_procurement_requests_org_status ON procurement_requests(organization_id, status);

-- ==========================================================
-- 2. REQUEST ITEMS -- what's being asked for, and how much
-- ==========================================================
CREATE TABLE IF NOT EXISTS procurement_request_items (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id uuid NOT NULL REFERENCES procurement_requests(id) ON DELETE CASCADE,
  inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL, -- optional link to an existing catalogue item
  item_name text NOT NULL,                        -- free-text description; independent of inventory_item_id so a
                                                    -- brand-new item (not yet in inventory) can still be requested
  quantity numeric(10,2) NOT NULL DEFAULT 1,
  estimated_unit_cost numeric(12,2),
  notes text,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_procurement_reqitems_request ON procurement_request_items(request_id);
CREATE INDEX IF NOT EXISTS idx_procurement_reqitems_org ON procurement_request_items(organization_id);

-- ==========================================================
-- 3. PURCHASE ORDERS -- placed with a vendor, converted from a request
-- ==========================================================
CREATE TABLE IF NOT EXISTS procurement_orders (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_code text NOT NULL,                       -- e.g. PO-0001, unique per org
  request_id uuid REFERENCES procurement_requests(id) ON DELETE SET NULL, -- nullable: a PO can also be created directly, without a prior request
  vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft',           -- 'draft', 'sent', 'partially_received', 'received', 'cancelled'
  expected_date date,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,  -- sum of line items, kept in sync by the app on every line edit
  notes text,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(organization_id, order_code)
);

CREATE INDEX IF NOT EXISTS idx_procurement_orders_org_status ON procurement_orders(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_procurement_orders_vendor ON procurement_orders(vendor_id);

-- ==========================================================
-- 4. ORDER ITEMS -- what was actually ordered, at what price
-- ==========================================================
CREATE TABLE IF NOT EXISTS procurement_order_items (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id uuid NOT NULL REFERENCES procurement_orders(id) ON DELETE CASCADE,
  inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL,
  item_name text NOT NULL,
  quantity_ordered numeric(10,2) NOT NULL DEFAULT 1,
  quantity_received numeric(10,2) NOT NULL DEFAULT 0,
  unit_cost numeric(12,2) NOT NULL DEFAULT 0,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_procurement_orditems_order ON procurement_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_procurement_orditems_org ON procurement_order_items(organization_id);

-- ==========================================================
-- 5. RECEIPTS -- a log of each receiving event against an order
-- ==========================================================
-- Kept as its own append-only log (rather than just mutating
-- quantity_received on the order item) so there's an audit trail of
-- WHEN goods arrived and WHO received them, across possibly several
-- partial deliveries for one order item.
CREATE TABLE IF NOT EXISTS procurement_receipts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_item_id uuid NOT NULL REFERENCES procurement_order_items(id) ON DELETE CASCADE,
  quantity_received numeric(10,2) NOT NULL,
  received_by_staff_id uuid REFERENCES staff_members(id) ON DELETE SET NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_procurement_receipts_orderitem ON procurement_receipts(order_item_id);
CREATE INDEX IF NOT EXISTS idx_procurement_receipts_org ON procurement_receipts(organization_id);

-- ==========================================================
-- 6. RLS -- tenant-isolated from the start via current_user_org_id()
-- ==========================================================
ALTER TABLE procurement_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_procurement_requests_all ON procurement_requests;
CREATE POLICY tenant_procurement_requests_all ON procurement_requests FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_procurement_reqitems_all ON procurement_request_items;
CREATE POLICY tenant_procurement_reqitems_all ON procurement_request_items FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_procurement_orders_all ON procurement_orders;
CREATE POLICY tenant_procurement_orders_all ON procurement_orders FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_procurement_orditems_all ON procurement_order_items;
CREATE POLICY tenant_procurement_orditems_all ON procurement_order_items FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_procurement_receipts_all ON procurement_receipts;
CREATE POLICY tenant_procurement_receipts_all ON procurement_receipts FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- ==========================================================
-- 7. STATS RPC -- fast counts for the dashboard tiles
-- ==========================================================
CREATE OR REPLACE FUNCTION procurement_stats()
RETURNS TABLE (
  pending_requests bigint,
  open_orders bigint,
  total_open_order_value numeric,
  received_this_month bigint
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
    (SELECT COUNT(*) FROM procurement_requests r WHERE r.organization_id = v_org AND r.status = 'pending') as pending_requests,
    (SELECT COUNT(*) FROM procurement_orders o WHERE o.organization_id = v_org AND o.status IN ('draft','sent','partially_received')) as open_orders,
    (SELECT COALESCE(SUM(o.total_amount), 0) FROM procurement_orders o WHERE o.organization_id = v_org AND o.status IN ('draft','sent','partially_received')) as total_open_order_value,
    (SELECT COUNT(*) FROM procurement_receipts rc WHERE rc.organization_id = v_org AND rc.received_at >= date_trunc('month', CURRENT_DATE)) as received_this_month;
END $$;

GRANT EXECUTE ON FUNCTION procurement_stats() TO authenticated;

-- ==========================================================
-- 8. APPROVE / REJECT REQUEST RPCs
-- ==========================================================
CREATE OR REPLACE FUNCTION procurement_review_request(
  p_request_id uuid,
  p_approve boolean,
  p_reviewer_staff_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
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
  SELECT r.status INTO v_status FROM procurement_requests r WHERE r.id = p_request_id AND r.organization_id = v_org FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Request not found in this organization';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending requests can be reviewed (this request is %)', v_status;
  END IF;

  UPDATE procurement_requests
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
      reviewed_by_staff_id = p_reviewer_staff_id,
      review_notes = p_notes,
      reviewed_at = now()
  WHERE id = p_request_id;
END $$;

GRANT EXECUTE ON FUNCTION procurement_review_request(uuid, boolean, uuid, text) TO authenticated;

-- ==========================================================
-- 9. CONVERT-TO-ORDER RPC -- builds a PO from an approved request
-- ==========================================================
-- Copies every request item into a new order (with its own line
-- items), sets the request's status to 'ordered' so it can't be
-- converted twice, and returns the new order id. The estimated cost on
-- the request item becomes the order item's initial unit_cost -- staff
-- can adjust it before sending, since real quotes often differ from
-- the original estimate.
CREATE OR REPLACE FUNCTION procurement_convert_request_to_order(
  p_request_id uuid,
  p_vendor_id uuid DEFAULT NULL,
  p_expected_date date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_status text;
  v_order_id uuid;
  v_order_code text;
  v_next_num integer;
  v_total numeric := 0;
  v_item record;
BEGIN
  SELECT r.status INTO v_status FROM procurement_requests r WHERE r.id = p_request_id AND r.organization_id = v_org FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Request not found in this organization';
  END IF;
  IF v_status <> 'approved' THEN
    RAISE EXCEPTION 'Only approved requests can be converted to an order (this request is %)', v_status;
  END IF;

  SELECT COALESCE(MAX(CAST(NULLIF(regexp_replace(o.order_code, '\D', '', 'g'), '') AS integer)), 0) + 1
    INTO v_next_num
    FROM procurement_orders o WHERE o.organization_id = v_org;
  v_order_code := 'PO-' || LPAD(v_next_num::text, 4, '0');

  INSERT INTO procurement_orders (order_code, request_id, vendor_id, expected_date, organization_id)
  VALUES (v_order_code, p_request_id, p_vendor_id, p_expected_date, v_org)
  RETURNING id INTO v_order_id;

  FOR v_item IN
    SELECT ri.inventory_item_id, ri.item_name, ri.quantity, COALESCE(ri.estimated_unit_cost, 0) as unit_cost
    FROM procurement_request_items ri WHERE ri.request_id = p_request_id AND ri.organization_id = v_org
  LOOP
    INSERT INTO procurement_order_items (order_id, inventory_item_id, item_name, quantity_ordered, unit_cost, organization_id)
    VALUES (v_order_id, v_item.inventory_item_id, v_item.item_name, v_item.quantity, v_item.unit_cost, v_org);
    v_total := v_total + (v_item.quantity * v_item.unit_cost);
  END LOOP;

  UPDATE procurement_orders SET total_amount = v_total WHERE id = v_order_id;
  UPDATE procurement_requests SET status = 'ordered' WHERE id = p_request_id;

  RETURN v_order_id;
END $$;

GRANT EXECUTE ON FUNCTION procurement_convert_request_to_order(uuid, uuid, date) TO authenticated;

-- ==========================================================
-- 10. RECEIVE-ITEM RPC -- logs a receipt, credits inventory, updates order status
-- ==========================================================
-- Refuses to over-receive (quantity_received can never exceed
-- quantity_ordered). When the order item is linked to an
-- inventory_items row, quantity_on_hand is credited by the received
-- amount -- this is the one place procurement and inventory actually
-- touch, kept server-side so the two can never drift out of sync from
-- a client-side bug. After each receipt, the parent order's status is
-- recomputed: 'received' if every line is fully received,
-- 'partially_received' otherwise.
CREATE OR REPLACE FUNCTION procurement_receive_item(
  p_order_item_id uuid,
  p_quantity numeric,
  p_received_by_staff_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_order_id uuid;
  v_inventory_item_id uuid;
  v_ordered numeric;
  v_already_received numeric;
  v_order_status text;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity received must be positive';
  END IF;

  SELECT oi.order_id, oi.inventory_item_id, oi.quantity_ordered, oi.quantity_received
    INTO v_order_id, v_inventory_item_id, v_ordered, v_already_received
    FROM procurement_order_items oi
    WHERE oi.id = p_order_item_id AND oi.organization_id = v_org
    FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order item not found in this organization';
  END IF;
  IF v_already_received + p_quantity > v_ordered THEN
    RAISE EXCEPTION 'Cannot receive % — only % of % remain outstanding', p_quantity, (v_ordered - v_already_received), v_ordered;
  END IF;

  INSERT INTO procurement_receipts (order_item_id, quantity_received, received_by_staff_id, notes, organization_id)
  VALUES (p_order_item_id, p_quantity, p_received_by_staff_id, p_notes, v_org);

  UPDATE procurement_order_items SET quantity_received = quantity_received + p_quantity WHERE id = p_order_item_id;

  IF v_inventory_item_id IS NOT NULL THEN
    UPDATE inventory_items SET quantity_on_hand = quantity_on_hand + p_quantity, updated_at = now()
    WHERE id = v_inventory_item_id AND organization_id = v_org;
  END IF;

  SELECT CASE
    WHEN bool_and(oi.quantity_received >= oi.quantity_ordered) THEN 'received'
    WHEN bool_or(oi.quantity_received > 0) THEN 'partially_received'
    ELSE 'sent'
  END INTO v_order_status
  FROM procurement_order_items oi WHERE oi.order_id = v_order_id;

  UPDATE procurement_orders SET status = v_order_status, updated_at = now() WHERE id = v_order_id;
END $$;

GRANT EXECUTE ON FUNCTION procurement_receive_item(uuid, numeric, uuid, text) TO authenticated;
