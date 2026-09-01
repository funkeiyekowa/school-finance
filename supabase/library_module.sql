-- =====================================================================
-- LIBRARY MODULE
-- =====================================================================
-- Adds real functionality behind the "Library" module row in the
-- Platform Admin > Module Catalogue (key='library'), which previously
-- had zero dashboard pages built for it.
--
-- Scope: a book catalogue (with copies -- a title can have multiple
-- physical copies, each independently borrowable), borrowing/returns
-- with due dates and overdue fines, and reservations for a copy that's
-- currently out. Borrowers are either students or staff (a school
-- library serves both).
--
-- Conventions followed (see fix_paginated_ambiguous_columns.sql,
-- transport_module.sql, lms_module.sql):
--   * RLS via current_user_org_id() from the start, never "USING (true)".
--   * Any RPC's RETURNS TABLE column names avoid colliding with bare
--     identifiers used in its body (the 42702 "ambiguous column" bug)
--     -- every table-column reference in a function body is qualified
--     with a table alias.
--   * organization_id has no DB-side default -- every INSERT from the
--     client must set it explicitly (see the LMS RLS-violation fix:
--     commit 9b0ec3f). This file's own RPCs set it via v_org so
--     server-side writes (checkout/return) can't get it wrong.
--
-- Run order: after saas_foundation.sql / multi_tenant_migration.sql
-- (current_user_org_id()), operations_migration.sql (staff_members),
-- and the students table.
--
-- SAFE TO RE-RUN.
-- =====================================================================

-- ==========================================================
-- 1. BOOKS (catalogue entry -- one row per title)
-- ==========================================================
CREATE TABLE IF NOT EXISTS library_books (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  isbn text,
  title text NOT NULL,
  author text,
  publisher text,
  category text,                          -- free-text shelf category, e.g. 'Fiction', 'Science', 'Reference'
  description text,
  cover_color text DEFAULT '#0F2A47',      -- simple visual identity, no image upload needed
  status text NOT NULL DEFAULT 'active',   -- 'active', 'retired' (withdrawn from circulation)
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_library_books_org ON library_books(organization_id);
CREATE INDEX IF NOT EXISTS idx_library_books_org_status ON library_books(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_library_books_org_title ON library_books(organization_id, title);

-- ==========================================================
-- 2. COPIES (physical items -- a title can have several)
-- ==========================================================
CREATE TABLE IF NOT EXISTS library_book_copies (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  book_id uuid NOT NULL REFERENCES library_books(id) ON DELETE CASCADE,
  copy_code text NOT NULL,                 -- e.g. LIB-0001, unique per org
  condition text NOT NULL DEFAULT 'good',  -- 'good', 'worn', 'damaged', 'lost'
  status text NOT NULL DEFAULT 'available',-- 'available', 'borrowed', 'reserved', 'lost', 'retired'
  shelf_location text,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(organization_id, copy_code)
);

CREATE INDEX IF NOT EXISTS idx_library_copies_book ON library_book_copies(book_id);
CREATE INDEX IF NOT EXISTS idx_library_copies_org_status ON library_book_copies(organization_id, status);

-- ==========================================================
-- 3. BORROWERS -- students or staff, never both on one row
-- ==========================================================
-- No separate "members" table: a borrower is looked up directly from
-- students / staff_members at checkout time (same pattern as
-- transport_student_assignments referencing students directly), kept
-- on the loan row as two nullable FKs with a CHECK that exactly one is set.

-- ==========================================================
-- 4. LOANS (checkout / return / fines)
-- ==========================================================
CREATE TABLE IF NOT EXISTS library_loans (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  copy_id uuid NOT NULL REFERENCES library_book_copies(id) ON DELETE CASCADE,
  student_id uuid REFERENCES students(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES staff_members(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active',   -- 'active', 'returned', 'lost'
  borrowed_at timestamptz NOT NULL DEFAULT now(),
  due_date date NOT NULL,
  returned_at timestamptz,
  fine_amount numeric(10,2) NOT NULL DEFAULT 0,
  fine_paid boolean NOT NULL DEFAULT false,
  notes text,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  CHECK ((student_id IS NOT NULL AND staff_id IS NULL) OR (student_id IS NULL AND staff_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_library_loans_copy ON library_loans(copy_id);
CREATE INDEX IF NOT EXISTS idx_library_loans_student ON library_loans(student_id);
CREATE INDEX IF NOT EXISTS idx_library_loans_staff ON library_loans(staff_id);
CREATE INDEX IF NOT EXISTS idx_library_loans_org_status ON library_loans(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_library_loans_due ON library_loans(organization_id, due_date) WHERE status = 'active';

-- ==========================================================
-- 5. RESERVATIONS -- queue for a copy/title that's currently out
-- ==========================================================
CREATE TABLE IF NOT EXISTS library_reservations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  book_id uuid NOT NULL REFERENCES library_books(id) ON DELETE CASCADE,
  student_id uuid REFERENCES students(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES staff_members(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',  -- 'pending', 'fulfilled', 'cancelled'
  reserved_at timestamptz NOT NULL DEFAULT now(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  CHECK ((student_id IS NOT NULL AND staff_id IS NULL) OR (student_id IS NULL AND staff_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_library_reservations_book ON library_reservations(book_id);
CREATE INDEX IF NOT EXISTS idx_library_reservations_org_status ON library_reservations(organization_id, status);

-- ==========================================================
-- 6. RLS -- tenant-isolated from the start via current_user_org_id()
-- ==========================================================
ALTER TABLE library_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_book_copies ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_library_books_all ON library_books;
CREATE POLICY tenant_library_books_all ON library_books FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_library_copies_all ON library_book_copies;
CREATE POLICY tenant_library_copies_all ON library_book_copies FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_library_loans_all ON library_loans;
CREATE POLICY tenant_library_loans_all ON library_loans FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_library_reservations_all ON library_reservations;
CREATE POLICY tenant_library_reservations_all ON library_reservations FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- ==========================================================
-- 7. STATS RPC -- fast counts for the dashboard tiles
-- ==========================================================
CREATE OR REPLACE FUNCTION library_stats()
RETURNS TABLE (
  total_titles bigint,
  total_copies bigint,
  available_copies bigint,
  active_loans bigint,
  overdue_loans bigint
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
    (SELECT COUNT(*) FROM library_books b WHERE b.organization_id = v_org AND b.status = 'active') as total_titles,
    (SELECT COUNT(*) FROM library_book_copies c WHERE c.organization_id = v_org AND c.status <> 'retired') as total_copies,
    (SELECT COUNT(*) FROM library_book_copies c WHERE c.organization_id = v_org AND c.status = 'available') as available_copies,
    (SELECT COUNT(*) FROM library_loans l WHERE l.organization_id = v_org AND l.status = 'active') as active_loans,
    (SELECT COUNT(*) FROM library_loans l WHERE l.organization_id = v_org AND l.status = 'active' AND l.due_date < CURRENT_DATE) as overdue_loans;
END $$;

GRANT EXECUTE ON FUNCTION library_stats() TO authenticated;

-- ==========================================================
-- 8. CHECKOUT RPC -- atomically creates the loan and flips the copy
-- ==========================================================
-- Doing this as one RPC (instead of two client-side writes) avoids a
-- race where two staff members check out the same "available" copy at
-- the same instant, and keeps the due-date default (14 days) and the
-- one-active-loan-per-copy rule enforced server-side rather than
-- trusted to the UI.
CREATE OR REPLACE FUNCTION library_checkout_copy(
  p_copy_id uuid,
  p_student_id uuid DEFAULT NULL,
  p_staff_id uuid DEFAULT NULL,
  p_due_date date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_copy_status text;
  v_loan_id uuid;
  v_due date := COALESCE(p_due_date, (CURRENT_DATE + INTERVAL '14 days')::date);
BEGIN
  IF (p_student_id IS NULL) = (p_staff_id IS NULL) THEN
    RAISE EXCEPTION 'Exactly one of student or staff must be given';
  END IF;

  SELECT c.status INTO v_copy_status FROM library_book_copies c
  WHERE c.id = p_copy_id AND c.organization_id = v_org
  FOR UPDATE;

  IF v_copy_status IS NULL THEN
    RAISE EXCEPTION 'Copy not found in this organization';
  END IF;
  IF v_copy_status <> 'available' THEN
    RAISE EXCEPTION 'Copy is not available (status: %)', v_copy_status;
  END IF;

  INSERT INTO library_loans (copy_id, student_id, staff_id, due_date, organization_id)
  VALUES (p_copy_id, p_student_id, p_staff_id, v_due, v_org)
  RETURNING id INTO v_loan_id;

  UPDATE library_book_copies SET status = 'borrowed' WHERE id = p_copy_id;

  RETURN v_loan_id;
END $$;

GRANT EXECUTE ON FUNCTION library_checkout_copy(uuid, uuid, uuid, date) TO authenticated;

-- ==========================================================
-- 9. RETURN RPC -- closes the loan, computes an overdue fine, frees the copy
-- ==========================================================
-- p_fine_per_day: the org's fine rate, passed in from the app (school-
-- configurable, not hardcoded here) rather than stored per-org in the
-- DB, since this module doesn't otherwise need a settings table yet.
CREATE OR REPLACE FUNCTION library_return_copy(
  p_loan_id uuid,
  p_condition text DEFAULT NULL,
  p_fine_per_day numeric DEFAULT 0
)
RETURNS TABLE (fine_result numeric, days_late_result integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_copy_id uuid;
  v_due date;
  v_status text;
  v_days_late integer;
  v_fine numeric;
BEGIN
  SELECT l.copy_id, l.due_date, l.status INTO v_copy_id, v_due, v_status
  FROM library_loans l WHERE l.id = p_loan_id AND l.organization_id = v_org
  FOR UPDATE;

  IF v_copy_id IS NULL THEN
    RAISE EXCEPTION 'Loan not found in this organization';
  END IF;
  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'Loan is already %', v_status;
  END IF;

  v_days_late := GREATEST(0, (CURRENT_DATE - v_due));
  v_fine := v_days_late * GREATEST(0, p_fine_per_day);

  UPDATE library_loans
  SET status = 'returned', returned_at = now(), fine_amount = v_fine
  WHERE id = p_loan_id;

  UPDATE library_book_copies
  SET status = 'available',
      condition = COALESCE(p_condition, condition)
  WHERE id = v_copy_id;

  RETURN QUERY SELECT v_fine, v_days_late;
END $$;

GRANT EXECUTE ON FUNCTION library_return_copy(uuid, text, numeric) TO authenticated;
