-- =====================================================================
-- HEALTH / CLINIC MODULE
-- =====================================================================
-- Adds real functionality behind the "Health / Clinic" module row in
-- the Platform Admin > Module Catalogue (key='clinic'), which
-- previously had zero dashboard pages built for it.
--
-- Scope: per-student (and optionally per-staff) medical profile
-- (blood group, allergies, chronic conditions, emergency contact),
-- an append-only clinic visit log (chief complaint, vitals, diagnosis,
-- treatment given, referred out), medications dispensed during each
-- visit with a small stand-alone clinic-medication inventory
-- (separate from operations inventory_items so nurse stock doesn't
-- clutter the general supplies list and controlled meds stay auditable),
-- vaccination history, and health incidents (parent-notifiable events).
--
-- Conventions followed (see fix_paginated_ambiguous_columns.sql,
-- transport/lms/library/hostel/payroll/procurement/assets module files):
--   * RLS via current_user_org_id() from the start.
--   * Any RPC's RETURNS TABLE column names avoid colliding with bare
--     identifiers used in its body (the 42702 "ambiguous column" bug).
--   * organization_id has no DB-side default -- every INSERT from the
--     client must set it explicitly. Server-side RPCs set it via v_org.
--
-- Run order: after saas_foundation.sql / multi_tenant_migration.sql
-- (current_user_org_id()), operations_migration.sql (staff_members),
-- and schema.sql (students).
--
-- SAFE TO RE-RUN.
-- =====================================================================

-- ==========================================================
-- 1. PATIENT RECORDS -- student/staff medical profile
-- ==========================================================
-- One row per (student or staff) subject that has any medical info
-- worth keeping on file. Not required for every student -- created
-- lazily the first time the nurse enters something for them.
CREATE TABLE IF NOT EXISTS clinic_patient_records (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  subject_type text NOT NULL,                       -- 'student' or 'staff'
  student_id uuid REFERENCES students(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES staff_members(id) ON DELETE CASCADE,
  blood_group text,                                 -- e.g. 'O+', 'AB-'
  allergies text,                                    -- free text; the presence of anything here flags them on the dashboard
  chronic_conditions text,                           -- asthma, diabetes, etc.
  current_medications text,                          -- prescriptions the student takes at home
  emergency_contact_name text,
  emergency_contact_phone text,
  emergency_contact_relationship text,
  physician_name text,
  physician_phone text,
  insurance_provider text,
  notes text,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  -- Exactly one of student_id / staff_id must be set, matching subject_type.
  CONSTRAINT clinic_patient_records_subject_check CHECK (
    (subject_type = 'student' AND student_id IS NOT NULL AND staff_id IS NULL)
    OR (subject_type = 'staff' AND staff_id IS NOT NULL AND student_id IS NULL)
  )
);

-- One patient record per subject per org
CREATE UNIQUE INDEX IF NOT EXISTS uq_clinic_patient_student ON clinic_patient_records(organization_id, student_id) WHERE student_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_clinic_patient_staff ON clinic_patient_records(organization_id, staff_id) WHERE staff_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clinic_patient_org ON clinic_patient_records(organization_id);

-- ==========================================================
-- 2. VISITS -- append-only clinic visit log
-- ==========================================================
CREATE TABLE IF NOT EXISTS clinic_visits (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  visit_code text NOT NULL,                          -- e.g. CV-0001
  subject_type text NOT NULL,                        -- 'student' or 'staff'
  student_id uuid REFERENCES students(id) ON DELETE SET NULL,
  staff_id uuid REFERENCES staff_members(id) ON DELETE SET NULL,
  visit_date timestamptz NOT NULL DEFAULT now(),
  chief_complaint text NOT NULL,
  temperature_c numeric(4,1),                        -- e.g. 37.5
  blood_pressure text,                                -- e.g. '120/80'
  pulse_bpm integer,
  diagnosis text,
  treatment_given text,
  outcome text NOT NULL DEFAULT 'resolved',          -- 'resolved', 'sent_home', 'referred_out', 'admitted'
  referred_to text,                                   -- hospital/clinic if referred out
  parent_notified boolean NOT NULL DEFAULT false,
  attended_by_staff_id uuid REFERENCES staff_members(id) ON DELETE SET NULL, -- nurse who attended
  notes text,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(organization_id, visit_code),
  CONSTRAINT clinic_visits_subject_check CHECK (
    (subject_type = 'student' AND student_id IS NOT NULL AND staff_id IS NULL)
    OR (subject_type = 'staff' AND staff_id IS NOT NULL AND student_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_clinic_visits_org_date ON clinic_visits(organization_id, visit_date DESC);
CREATE INDEX IF NOT EXISTS idx_clinic_visits_student ON clinic_visits(student_id);
CREATE INDEX IF NOT EXISTS idx_clinic_visits_staff ON clinic_visits(staff_id);

-- ==========================================================
-- 3. CLINIC MEDICATION INVENTORY -- nurse's stock
-- ==========================================================
-- Kept separate from operations inventory_items on purpose: nurse's
-- controlled/OTC stock has its own dosage/expiry semantics and
-- shouldn't clutter general supplies lists.
CREATE TABLE IF NOT EXISTS clinic_medications_inventory (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  medication_code text NOT NULL,                     -- e.g. MED-0001
  name text NOT NULL,                                 -- e.g. 'Paracetamol 500mg tablets'
  dosage_form text,                                   -- 'tablet', 'syrup', 'ointment', 'injection'
  strength text,                                      -- '500mg', '10mg/ml'
  quantity_on_hand numeric(12,2) NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'unit',                  -- 'tablet', 'ml', 'g', 'pack'
  reorder_level numeric(12,2) NOT NULL DEFAULT 0,
  expiry_date date,
  active boolean NOT NULL DEFAULT true,
  notes text,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(organization_id, medication_code)
);

CREATE INDEX IF NOT EXISTS idx_clinic_meds_org_active ON clinic_medications_inventory(organization_id, active);

-- ==========================================================
-- 4. MEDICATION DISPENSING -- per-visit log
-- ==========================================================
CREATE TABLE IF NOT EXISTS clinic_medications_dispensed (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  visit_id uuid NOT NULL REFERENCES clinic_visits(id) ON DELETE CASCADE,
  medication_id uuid REFERENCES clinic_medications_inventory(id) ON DELETE SET NULL,
  medication_name text NOT NULL,                     -- snapshotted from inventory at dispensing time, so a later rename/delete doesn't lose the record
  dosage text,                                        -- e.g. '1 tablet twice a day for 3 days'
  quantity_dispensed numeric(12,2) NOT NULL DEFAULT 1,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clinic_meds_disp_visit ON clinic_medications_dispensed(visit_id);
CREATE INDEX IF NOT EXISTS idx_clinic_meds_disp_org ON clinic_medications_dispensed(organization_id);

-- ==========================================================
-- 5. VACCINATIONS -- immunization history per subject
-- ==========================================================
CREATE TABLE IF NOT EXISTS clinic_vaccinations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  subject_type text NOT NULL,                        -- 'student' or 'staff'
  student_id uuid REFERENCES students(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES staff_members(id) ON DELETE CASCADE,
  vaccine_name text NOT NULL,                         -- e.g. 'MMR', 'Hepatitis B'
  administered_date date NOT NULL,
  administered_by text,                               -- free text: nurse name or external clinic
  dose_number integer,                                -- 1, 2, 3 for multi-dose series
  batch_number text,
  next_dose_due date,
  notes text,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT clinic_vaccinations_subject_check CHECK (
    (subject_type = 'student' AND student_id IS NOT NULL AND staff_id IS NULL)
    OR (subject_type = 'staff' AND staff_id IS NOT NULL AND student_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_clinic_vaccinations_student ON clinic_vaccinations(student_id);
CREATE INDEX IF NOT EXISTS idx_clinic_vaccinations_staff ON clinic_vaccinations(staff_id);
CREATE INDEX IF NOT EXISTS idx_clinic_vaccinations_org_due ON clinic_vaccinations(organization_id, next_dose_due) WHERE next_dose_due IS NOT NULL;

-- ==========================================================
-- 6. HEALTH INCIDENTS -- parent-notifiable events, injuries, outbreaks
-- ==========================================================
CREATE TABLE IF NOT EXISTS clinic_health_incidents (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_code text NOT NULL,                       -- e.g. HI-0001
  incident_type text NOT NULL DEFAULT 'injury',      -- 'injury', 'illness', 'outbreak', 'allergic_reaction', 'other'
  incident_date timestamptz NOT NULL DEFAULT now(),
  student_id uuid REFERENCES students(id) ON DELETE SET NULL, -- nullable: an outbreak may not target a single student
  location text,                                      -- e.g. 'Science Lab 2', 'Football Field'
  description text NOT NULL,
  action_taken text,
  severity text NOT NULL DEFAULT 'minor',            -- 'minor', 'moderate', 'severe'
  parent_notified boolean NOT NULL DEFAULT false,
  parent_notified_at timestamptz,
  reported_by_staff_id uuid REFERENCES staff_members(id) ON DELETE SET NULL,
  visit_id uuid REFERENCES clinic_visits(id) ON DELETE SET NULL, -- if a clinic visit resulted
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(organization_id, incident_code)
);

CREATE INDEX IF NOT EXISTS idx_clinic_incidents_org_date ON clinic_health_incidents(organization_id, incident_date DESC);
CREATE INDEX IF NOT EXISTS idx_clinic_incidents_student ON clinic_health_incidents(student_id);

-- ==========================================================
-- 7. RLS -- tenant-isolated from the start via current_user_org_id()
-- ==========================================================
ALTER TABLE clinic_patient_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_medications_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_medications_dispensed ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_vaccinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_health_incidents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_clinic_patient_records_all ON clinic_patient_records;
CREATE POLICY tenant_clinic_patient_records_all ON clinic_patient_records FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_clinic_visits_all ON clinic_visits;
CREATE POLICY tenant_clinic_visits_all ON clinic_visits FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_clinic_meds_inv_all ON clinic_medications_inventory;
CREATE POLICY tenant_clinic_meds_inv_all ON clinic_medications_inventory FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_clinic_meds_disp_all ON clinic_medications_dispensed;
CREATE POLICY tenant_clinic_meds_disp_all ON clinic_medications_dispensed FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_clinic_vaccinations_all ON clinic_vaccinations;
CREATE POLICY tenant_clinic_vaccinations_all ON clinic_vaccinations FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_clinic_incidents_all ON clinic_health_incidents;
CREATE POLICY tenant_clinic_incidents_all ON clinic_health_incidents FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- ==========================================================
-- 8. STATS RPC -- dashboard KPI tiles
-- ==========================================================
CREATE OR REPLACE FUNCTION clinic_stats()
RETURNS TABLE (
  visits_today bigint,
  visits_this_week bigint,
  open_referrals bigint,
  patients_with_allergies bigint,
  low_stock_medications bigint,
  incidents_this_month bigint,
  vaccinations_due_soon bigint
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
    (SELECT COUNT(*) FROM clinic_visits v WHERE v.organization_id = v_org AND v.visit_date >= CURRENT_DATE) as visits_today,
    (SELECT COUNT(*) FROM clinic_visits v WHERE v.organization_id = v_org AND v.visit_date >= date_trunc('week', CURRENT_DATE)) as visits_this_week,
    (SELECT COUNT(*) FROM clinic_visits v WHERE v.organization_id = v_org AND v.outcome = 'referred_out') as open_referrals,
    (SELECT COUNT(*) FROM clinic_patient_records p WHERE p.organization_id = v_org AND p.allergies IS NOT NULL AND trim(p.allergies) <> '') as patients_with_allergies,
    (SELECT COUNT(*) FROM clinic_medications_inventory m WHERE m.organization_id = v_org AND m.active = true AND m.quantity_on_hand <= m.reorder_level) as low_stock_medications,
    (SELECT COUNT(*) FROM clinic_health_incidents i WHERE i.organization_id = v_org AND i.incident_date >= date_trunc('month', CURRENT_DATE)) as incidents_this_month,
    (SELECT COUNT(*) FROM clinic_vaccinations vac WHERE vac.organization_id = v_org AND vac.next_dose_due IS NOT NULL AND vac.next_dose_due BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days') as vaccinations_due_soon;
END $$;

GRANT EXECUTE ON FUNCTION clinic_stats() TO authenticated;

-- ==========================================================
-- 9. LOG-VISIT RPC -- visit + dispensed meds + stock decrement, atomically
-- ==========================================================
-- Doing this server-side keeps stock-decrement in the same
-- transaction as the visit + dispense records, so a mid-flight
-- failure never leaves the nurse with a visit logged but stock
-- unchanged (or vice-versa). Row-locks each dispensed medication row
-- with FOR UPDATE while checking there's enough quantity_on_hand.
--
-- p_meds format: jsonb array like
--   [ { "medication_id": "uuid", "medication_name": "Paracetamol", "dosage": "1 tab bid x 3", "quantity_dispensed": 6 },
--     { "medication_id": null,   "medication_name": "Home paracetamol", "dosage": "as needed", "quantity_dispensed": 0 } ]
-- medication_id is nullable so a nurse can record dispensing a med
-- that isn't in clinic stock (e.g. one the parent brought in).
CREATE OR REPLACE FUNCTION clinic_log_visit(
  p_subject_type text,
  p_student_id uuid,
  p_staff_id uuid,
  p_visit_code text,
  p_chief_complaint text,
  p_temperature_c numeric DEFAULT NULL,
  p_blood_pressure text DEFAULT NULL,
  p_pulse_bpm integer DEFAULT NULL,
  p_diagnosis text DEFAULT NULL,
  p_treatment_given text DEFAULT NULL,
  p_outcome text DEFAULT 'resolved',
  p_referred_to text DEFAULT NULL,
  p_parent_notified boolean DEFAULT false,
  p_attended_by_staff_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_meds jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_visit_id uuid;
  v_med jsonb;
  v_med_id uuid;
  v_med_qty numeric;
  v_med_stock numeric;
BEGIN
  IF p_subject_type NOT IN ('student', 'staff') THEN
    RAISE EXCEPTION 'subject_type must be student or staff';
  END IF;
  IF p_subject_type = 'student' AND p_student_id IS NULL THEN
    RAISE EXCEPTION 'student_id is required for a student visit';
  END IF;
  IF p_subject_type = 'staff' AND p_staff_id IS NULL THEN
    RAISE EXCEPTION 'staff_id is required for a staff visit';
  END IF;

  -- Row-lock any medications we're about to draw down and confirm we have enough BEFORE inserting the visit,
  -- so a failure here surfaces to the nurse without leaving a half-finished record.
  FOR v_med IN SELECT * FROM jsonb_array_elements(COALESCE(p_meds, '[]'::jsonb))
  LOOP
    v_med_id := NULLIF(v_med->>'medication_id', '')::uuid;
    v_med_qty := COALESCE((v_med->>'quantity_dispensed')::numeric, 0);
    IF v_med_id IS NOT NULL AND v_med_qty > 0 THEN
      SELECT m.quantity_on_hand INTO v_med_stock
        FROM clinic_medications_inventory m
        WHERE m.id = v_med_id AND m.organization_id = v_org
        FOR UPDATE;
      IF v_med_stock IS NULL THEN
        RAISE EXCEPTION 'Medication not found in this organization';
      END IF;
      IF v_med_stock < v_med_qty THEN
        RAISE EXCEPTION 'Not enough stock for medication (have %, need %)', v_med_stock, v_med_qty;
      END IF;
    END IF;
  END LOOP;

  INSERT INTO clinic_visits (
    visit_code, subject_type, student_id, staff_id,
    chief_complaint, temperature_c, blood_pressure, pulse_bpm,
    diagnosis, treatment_given, outcome, referred_to,
    parent_notified, attended_by_staff_id, notes, organization_id
  ) VALUES (
    p_visit_code,
    p_subject_type,
    CASE WHEN p_subject_type = 'student' THEN p_student_id ELSE NULL END,
    CASE WHEN p_subject_type = 'staff' THEN p_staff_id ELSE NULL END,
    p_chief_complaint, p_temperature_c, p_blood_pressure, p_pulse_bpm,
    p_diagnosis, p_treatment_given, p_outcome, p_referred_to,
    p_parent_notified, p_attended_by_staff_id, p_notes, v_org
  )
  RETURNING id INTO v_visit_id;

  -- Now insert dispensed meds and decrement stock.
  FOR v_med IN SELECT * FROM jsonb_array_elements(COALESCE(p_meds, '[]'::jsonb))
  LOOP
    v_med_id := NULLIF(v_med->>'medication_id', '')::uuid;
    v_med_qty := COALESCE((v_med->>'quantity_dispensed')::numeric, 0);

    INSERT INTO clinic_medications_dispensed (
      visit_id, medication_id, medication_name, dosage, quantity_dispensed, organization_id
    ) VALUES (
      v_visit_id,
      v_med_id,
      COALESCE(v_med->>'medication_name', ''),
      NULLIF(v_med->>'dosage', ''),
      v_med_qty,
      v_org
    );

    IF v_med_id IS NOT NULL AND v_med_qty > 0 THEN
      UPDATE clinic_medications_inventory
        SET quantity_on_hand = quantity_on_hand - v_med_qty, updated_at = now()
        WHERE id = v_med_id AND organization_id = v_org;
    END IF;
  END LOOP;

  RETURN v_visit_id;
END $$;

GRANT EXECUTE ON FUNCTION clinic_log_visit(text, uuid, uuid, text, text, numeric, text, integer, text, text, text, text, boolean, uuid, text, jsonb) TO authenticated;
