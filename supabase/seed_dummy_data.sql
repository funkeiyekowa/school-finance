-- ============================================================================
-- TEST DATA GENERATOR FOR SCHOOL FINANCE
-- ============================================================================
-- Matches the REAL schema in schema.sql + multi_tenant_migration.sql:
--   students          -> organization_id (NOT NULL), first_name/last_name/middle_name
--   staff_members     -> organization_id, full_name (no separate first/last)
--   income_entries    -> organization_id, receipt_no (unique NOT NULL), amount numeric
--   expense_entries   -> organization_id, voucher_no (unique NOT NULL), amount numeric
--
-- Three RPC functions:
-- 1. seed_dummy_data(p_org uuid)                          - generate test data
-- 2. delete_dummy_data(p_org uuid, p_delete_all boolean)   - delete test-only or all
-- 3. get_dummy_data_stats(p_org uuid)                      - counts/sums as JSON
--
-- All test records are marked is_test_data = true for selective deletion.
-- ============================================================================

-- ============================================================================
-- 0. Add is_test_data flag to the tables that need it (safe to re-run)
-- ============================================================================
ALTER TABLE students        ADD COLUMN IF NOT EXISTS is_test_data boolean NOT NULL DEFAULT false;
ALTER TABLE staff_members   ADD COLUMN IF NOT EXISTS is_test_data boolean NOT NULL DEFAULT false;
ALTER TABLE income_entries  ADD COLUMN IF NOT EXISTS is_test_data boolean NOT NULL DEFAULT false;
ALTER TABLE expense_entries ADD COLUMN IF NOT EXISTS is_test_data boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_students_test        ON students(organization_id, is_test_data);
CREATE INDEX IF NOT EXISTS idx_staff_members_test   ON staff_members(organization_id, is_test_data);
CREATE INDEX IF NOT EXISTS idx_income_entries_test  ON income_entries(organization_id, is_test_data);
CREATE INDEX IF NOT EXISTS idx_expense_entries_test ON expense_entries(organization_id, is_test_data);


-- ============================================================================
-- 1. SEED DUMMY DATA
-- ============================================================================
CREATE OR REPLACE FUNCTION seed_dummy_data(p_org uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_i int;
  v_run text := to_char(clock_timestamp(), 'HH24MISSMS'); -- uniquifier for this seed run

  v_income_cats  text[] := ARRAY['Tuition', 'Grants', 'Donations', 'Other'];
  v_expense_cats text[] := ARRAY['Salaries', 'Utilities', 'Maintenance', 'Supplies', 'Transportation'];

  v_first_names text[] := ARRAY['Ada','Chioma','Zainab','Amara','Blessing','Judith','Gloria','Patricia','Chukwu','Ife','Tunde','Kadir','Hassan','Adebayo','Emeka'];
  v_last_names  text[] := ARRAY['Okafor','Abubakar','Musa','Oluwaseun','Ibrahim','Nwosu','Adeyinka','Eze','Kolapo','Suleiman','Dike','Olumide','Chigbu','Yusuf','Ekanem'];
  v_grades      text[] := ARRAY['JSS1','JSS2','JSS3','SSS1','SSS2','SSS3'];
  v_genders     text[] := ARRAY['Male','Female'];

  v_staff_first text[] := ARRAY['Folake','Segun','Victoria','James','Amara','Kofi','Aisha','Samuel','Zoe','David'];
  v_staff_last  text[] := ARRAY['Adeniji','Okonkwo','Oluwade','Mbamalu','Chukwuma','Mensah','Hassan','Obi','Adebowale','Ekanem'];
  v_staff_types text[] := ARRAY['teaching','teaching','teaching','teaching','teaching','non_teaching','non_teaching','admin','admin','admin'];
BEGIN
  -- =====================================================================
  -- 50 Students
  -- =====================================================================
  FOR v_i IN 1..50 LOOP
    INSERT INTO students (
      organization_id, student_code, first_name, last_name, full_name, grade,
      gender, status, date_of_birth, admission_date, academic_year,
      guardian_name, guardian_phone, is_test_data, created_at, updated_at
    ) VALUES (
      p_org,
      'TSTU' || v_run || LPAD(v_i::text, 3, '0'),
      v_first_names[((v_i - 1) % array_length(v_first_names, 1)) + 1],
      v_last_names[((v_i - 1) % array_length(v_last_names, 1)) + 1],
      v_last_names[((v_i - 1) % array_length(v_last_names, 1)) + 1] || ' ' || v_first_names[((v_i - 1) % array_length(v_first_names, 1)) + 1],
      v_grades[((v_i - 1) % array_length(v_grades, 1)) + 1],
      v_genders[((v_i - 1) % array_length(v_genders, 1)) + 1],
      CASE WHEN random() < 0.8 THEN 'active' ELSE 'inactive' END,
      CURRENT_DATE - (random() * 5475)::int - 365,
      CURRENT_DATE - (random() * 730)::int,
      '2025/2026',
      'Guardian ' || v_i,
      '+234800' || LPAD((random() * 10000000)::int::text, 7, '0'),
      true,
      now(), now()
    );
  END LOOP;

  -- =====================================================================
  -- 30 Staff Members
  -- =====================================================================
  FOR v_i IN 1..30 LOOP
    INSERT INTO staff_members (
      organization_id, staff_code, full_name, email, phone, staff_type,
      status, date_joined, is_test_data, created_at, updated_at
    ) VALUES (
      p_org,
      'TSTF' || v_run || LPAD(v_i::text, 3, '0'),
      v_staff_first[((v_i - 1) % array_length(v_staff_first, 1)) + 1] || ' ' || v_staff_last[((v_i - 1) % array_length(v_staff_last, 1)) + 1],
      'test.staff' || v_run || v_i || '@school.test',
      '+234803' || LPAD((random() * 10000000)::int::text, 7, '0'),
      v_staff_types[((v_i - 1) % array_length(v_staff_types, 1)) + 1],
      'active',
      CURRENT_DATE - (random() * 730)::int,
      true,
      now(), now()
    );
  END LOOP;

  -- =====================================================================
  -- 20 Income Entries
  -- =====================================================================
  FOR v_i IN 1..20 LOOP
    INSERT INTO income_entries (
      receipt_no, date, category, description, amount, payment_method,
      organization_id, is_test_data, created_at, updated_at
    ) VALUES (
      'TINC' || v_run || LPAD(v_i::text, 3, '0'),
      CURRENT_DATE - (random() * 90)::int,
      v_income_cats[((v_i - 1) % array_length(v_income_cats, 1)) + 1],
      'Test income entry ' || v_i,
      round((random() * 450000 + 50000)::numeric, 2),
      'Cash',
      p_org,
      true,
      now(), now()
    );
  END LOOP;

  -- =====================================================================
  -- 20 Expense Entries
  -- =====================================================================
  FOR v_i IN 1..20 LOOP
    INSERT INTO expense_entries (
      voucher_no, date, category, description, amount, payment_method,
      organization_id, is_test_data, created_at, updated_at
    ) VALUES (
      'TEXP' || v_run || LPAD(v_i::text, 3, '0'),
      CURRENT_DATE - (random() * 90)::int,
      v_expense_cats[((v_i - 1) % array_length(v_expense_cats, 1)) + 1],
      'Test expense entry ' || v_i,
      round((random() * 180000 + 20000)::numeric, 2),
      'Cash',
      p_org,
      true,
      now(), now()
    );
  END LOOP;
END;
$$;


-- ============================================================================
-- 2. DELETE DUMMY DATA
-- ============================================================================
CREATE OR REPLACE FUNCTION delete_dummy_data(p_org uuid, p_delete_all boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_delete_all THEN
    DELETE FROM income_entries  WHERE organization_id = p_org;
    DELETE FROM expense_entries WHERE organization_id = p_org;
    DELETE FROM students        WHERE organization_id = p_org;
    DELETE FROM staff_members   WHERE organization_id = p_org;
  ELSE
    DELETE FROM income_entries  WHERE organization_id = p_org AND is_test_data = true;
    DELETE FROM expense_entries WHERE organization_id = p_org AND is_test_data = true;
    DELETE FROM students        WHERE organization_id = p_org AND is_test_data = true;
    DELETE FROM staff_members   WHERE organization_id = p_org AND is_test_data = true;
  END IF;
END;
$$;


-- ============================================================================
-- 3. GET DUMMY DATA STATS
-- ============================================================================
CREATE OR REPLACE FUNCTION get_dummy_data_stats(p_org uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result json;
BEGIN
  SELECT json_build_object(
    'total_students',  (SELECT COUNT(*) FROM students WHERE organization_id = p_org),
    'test_students',   (SELECT COUNT(*) FROM students WHERE organization_id = p_org AND is_test_data = true),
    'total_staff',     (SELECT COUNT(*) FROM staff_members WHERE organization_id = p_org),
    'test_staff',      (SELECT COUNT(*) FROM staff_members WHERE organization_id = p_org AND is_test_data = true),
    'total_income',    (SELECT COALESCE(SUM(amount), 0) FROM income_entries WHERE organization_id = p_org),
    'test_income',     (SELECT COALESCE(SUM(amount), 0) FROM income_entries WHERE organization_id = p_org AND is_test_data = true),
    'total_expenses',  (SELECT COALESCE(SUM(amount), 0) FROM expense_entries WHERE organization_id = p_org),
    'test_expenses',   (SELECT COALESCE(SUM(amount), 0) FROM expense_entries WHERE organization_id = p_org AND is_test_data = true)
  ) INTO v_result;

  RETURN v_result;
END;
$$;
