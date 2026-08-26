-- =====================================================================
-- FIX: Allow anonymous student code lookup during login
-- =====================================================================
-- The login page needs to verify student_code EXISTS before attempting
-- auth signIn. Without this, RLS blocks the query and shows
-- "Student code not found" even for valid codes.
--
-- SECURITY: We create a SECURITY DEFINER function that only returns
-- whether the code exists + status. It does NOT expose any sensitive
-- student data (no names, no guardians, no grades).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Public function: verify_student_code
-- ---------------------------------------------------------------------
-- Returns: { exists: bool, active: bool, login_email: text }
-- Callable by anonymous role (needed for login page)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_student_code(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_student RECORD;
  v_login_email TEXT;
BEGIN
  IF p_code IS NULL OR TRIM(p_code) = '' THEN
    RETURN jsonb_build_object('exists', false, 'active', false);
  END IF;

  SELECT id, student_code, status, profile_id
  INTO v_student
  FROM public.students
  WHERE UPPER(student_code) = UPPER(TRIM(p_code))
  LIMIT 1;

  IF v_student.id IS NULL THEN
    RETURN jsonb_build_object('exists', false, 'active', false);
  END IF;

  -- Compute the auto-generated login email
  v_login_email := LOWER(v_student.student_code) || '@student.local';

  RETURN jsonb_build_object(
    'exists', true,
    'active', v_student.status = 'active',
    'login_email', v_login_email,
    'has_auth', v_student.profile_id IS NOT NULL
  );
END;
$$;

-- Grant execute to anonymous and authenticated roles
GRANT EXECUTE ON FUNCTION public.verify_student_code(TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Verify: test with a known student code
-- ---------------------------------------------------------------------
-- Replace 'S295' with any real student code from your database
SELECT public.verify_student_code('S295') AS test_result;

-- Should return something like:
-- { "exists": true, "active": true, "login_email": "s295@student.local", "has_auth": true }
