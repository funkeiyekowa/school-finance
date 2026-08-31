-- =====================================================================
-- SEED DUMMY DATA FOR TESTING
-- =====================================================================
-- Generates realistic test data (students, staff, classes, transactions, etc.)
-- All dummy data is marked with is_test_data = true for easy cleanup
-- Run order: after all schema and core functions are in place
-- =====================================================================

CREATE OR REPLACE FUNCTION seed_dummy_data(p_org uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_student_count integer := 0;
  v_staff_count integer := 0;
  v_i integer;
  v_last_names text[] := ARRAY['Okafor', 'Johnson', 'Adeyemi', 'Ibrahim', 'Oluwaseun', 'Chukwu', 'Mensah', 'Osei', 'Nwosu', 'Bello'];
  v_first_names text[] := ARRAY['Ada', 'Kofi', 'Zainab', 'Chioma', 'Yusuf', 'Ama', 'Adekunle', 'Fatima', 'Kwame', 'Ndidi'];
  v_grades text[] := ARRAY['JSS1', 'JSS2', 'JSS3', 'SSS1', 'SSS2', 'SSS3'];
  v_genders text[] := ARRAY['Male', 'Female'];
  v_income_cats text[] := ARRAY['tuition', 'grants', 'donations', 'other'];
  v_expense_cats text[] := ARRAY['salaries', 'utilities', 'maintenance', 'supplies', 'transportation'];
  v_departments uuid[];
  v_student_id uuid;
  v_staff_id uuid;
  v_dept_id uuid;
BEGIN
  -- Get departments
  SELECT ARRAY_AGG(id) INTO v_departments FROM departments WHERE organization_id = p_org AND active = true LIMIT 5;
  IF v_departments IS NULL OR array_length(v_departments, 1) IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'No active departments found. Create departments first.'
    );
  END IF;

  -- Create 50 dummy students
  FOR v_i IN 1..50 LOOP
    INSERT INTO students (
      organization_id, student_code, full_name, first_name, last_name,
      grade, gender, status, is_test_data
    ) VALUES (
      p_org,
      'TST' || LPAD(v_i::text, 4, '0'),
      v_first_names[((v_i - 1) % array_length(v_first_names, 1)) + 1] || ' ' ||
      v_last_names[((v_i - 1) % array_length(v_last_names, 1)) + 1],
      v_first_names[((v_i - 1) % array_length(v_first_names, 1)) + 1],
      v_last_names[((v_i - 1) % array_length(v_last_names, 1)) + 1],
      v_grades[((v_i - 1) % array_length(v_grades, 1)) + 1],
      v_genders[((v_i - 1) % 2) + 1],
      CASE WHEN v_i % 10 = 0 THEN 'inactive' ELSE 'active' END,
      true
    );
    v_student_count := v_student_count + 1;
  END LOOP;

  -- Create 30 dummy staff members
  FOR v_i IN 1..30 LOOP
    v_dept_id := v_departments[((v_i - 1) % array_length(v_departments, 1)) + 1];
    INSERT INTO staff_members (
      organization_id, staff_code, full_name, email, phone, job_title,
      staff_type, department_id, status, is_test_data
    ) VALUES (
      p_org,
      'STF' || LPAD(v_i::text, 4, '0'),
      v_first_names[((v_i - 1) % array_length(v_first_names, 1)) + 1] || ' ' ||
      v_last_names[((v_i - 1) % array_length(v_last_names, 1)) + 1],
      'staff' || v_i || '@testschool.local',
      '0801' || LPAD((v_i * 1234567 % 10000000)::text, 7, '0'),
      CASE WHEN v_i % 3 = 0 THEN 'Vice Principal' WHEN v_i % 3 = 1 THEN 'Mathematics Teacher' ELSE 'English Teacher' END,
      CASE WHEN v_i % 2 = 0 THEN 'teaching' ELSE 'non_teaching' END,
      v_dept_id,
      CASE WHEN v_i % 5 = 0 THEN 'on_leave' ELSE 'active' END,
      true
    );
    v_staff_count := v_staff_count + 1;
  END LOOP;

  -- Create dummy financial records (income)
  INSERT INTO income (
    organization_id, amount, description, category, reference_number,
    transaction_date, notes, is_test_data
  ) SELECT
    p_org,
    (RANDOM() * 500000 + 50000)::decimal,
    'Test Income ' || v_i,
    v_income_cats[((v_i - 1) % array_length(v_income_cats, 1)) + 1],
    'INC' || LPAD(v_i::text, 6, '0'),
    NOW() - (RANDOM() * 90)::integer * INTERVAL '1 day',
    'Dummy test data',
    true
  FROM generate_series(1, 20) AS v_i;

  -- Create dummy financial records (expenses)
  INSERT INTO expenses (
    organization_id, amount, description, category, reference_number,
    transaction_date, notes, is_test_data
  ) SELECT
    p_org,
    (RANDOM() * 300000 + 30000)::decimal,
    'Test Expense ' || v_i,
    v_expense_cats[((v_i - 1) % array_length(v_expense_cats, 1)) + 1],
    'EXP' || LPAD(v_i::text, 6, '0'),
    NOW() - (RANDOM() * 90)::integer * INTERVAL '1 day',
    'Dummy test data',
    true
  FROM generate_series(1, 20) AS v_i;

  RETURN jsonb_build_object(
    'ok', true,
    'message', 'Dummy data created successfully',
    'students_created', v_student_count,
    'staff_created', v_staff_count,
    'income_records', 20,
    'expense_records', 20
  );
END $$;

REVOKE ALL ON FUNCTION seed_dummy_data(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION seed_dummy_data(uuid) TO authenticated;


-- =====================================================================
-- DELETE DUMMY DATA
-- =====================================================================

CREATE OR REPLACE FUNCTION delete_dummy_data(p_org uuid, p_delete_all boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_students_deleted integer;
  v_staff_deleted integer;
  v_income_deleted integer;
  v_expenses_deleted integer;
BEGIN
  IF p_delete_all THEN
    -- Delete all data for this org
    DELETE FROM students WHERE organization_id = p_org;
    GET DIAGNOSTICS v_students_deleted = ROW_COUNT;

    DELETE FROM staff_members WHERE organization_id = p_org;
    GET DIAGNOSTICS v_staff_deleted = ROW_COUNT;

    DELETE FROM income WHERE organization_id = p_org;
    GET DIAGNOSTICS v_income_deleted = ROW_COUNT;

    DELETE FROM expenses WHERE organization_id = p_org;
    GET DIAGNOSTICS v_expenses_deleted = ROW_COUNT;
  ELSE
    -- Delete only test data
    DELETE FROM students WHERE organization_id = p_org AND is_test_data = true;
    GET DIAGNOSTICS v_students_deleted = ROW_COUNT;

    DELETE FROM staff_members WHERE organization_id = p_org AND is_test_data = true;
    GET DIAGNOSTICS v_staff_deleted = ROW_COUNT;

    DELETE FROM income WHERE organization_id = p_org AND is_test_data = true;
    GET DIAGNOSTICS v_income_deleted = ROW_COUNT;

    DELETE FROM expenses WHERE organization_id = p_org AND is_test_data = true;
    GET DIAGNOSTICS v_expenses_deleted = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'message', CASE WHEN p_delete_all THEN 'All data deleted' ELSE 'Dummy data deleted' END,
    'students_deleted', v_students_deleted,
    'staff_deleted', v_staff_deleted,
    'income_deleted', v_income_deleted,
    'expenses_deleted', v_expenses_deleted
  );
END $$;

REVOKE ALL ON FUNCTION delete_dummy_data(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION delete_dummy_data(uuid, boolean) TO authenticated;


-- =====================================================================
-- GET DUMMY DATA STATS
-- =====================================================================

CREATE OR REPLACE FUNCTION get_dummy_data_stats(p_org uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_students', (SELECT COUNT(*) FROM students WHERE organization_id = p_org),
    'test_students', (SELECT COUNT(*) FROM students WHERE organization_id = p_org AND is_test_data = true),
    'total_staff', (SELECT COUNT(*) FROM staff_members WHERE organization_id = p_org),
    'test_staff', (SELECT COUNT(*) FROM staff_members WHERE organization_id = p_org AND is_test_data = true),
    'total_income', (SELECT COALESCE(SUM(amount), 0) FROM income WHERE organization_id = p_org),
    'test_income', (SELECT COALESCE(SUM(amount), 0) FROM income WHERE organization_id = p_org AND is_test_data = true),
    'total_expenses', (SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE organization_id = p_org),
    'test_expenses', (SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE organization_id = p_org AND is_test_data = true)
  ) INTO v_result;

  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION get_dummy_data_stats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_dummy_data_stats(uuid) TO authenticated;
