-- =====================================================================
-- GRIEVANCES MODULE — student/parent complaints with a staff triage queue
-- =====================================================================
-- Run order: after saas_foundation.sql (#22 — is_org_admin,
-- is_platform_admin), multi_tenant_migration.sql (current_user_org_id)
-- and rls_role_scoped_access.sql (is_staff_user, my_linked_student_ids).
-- It creates a NEW table and only ever adds policies to that new table,
-- so it touches nothing existing and can be run last at any time.
-- Idempotent (CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE / DROP
-- POLICY IF EXISTS). Manual apply in the Supabase SQL editor.
--
-- WHY: the app had no way for a student or parent to raise an issue and
-- no queue for staff to work one. Modelled on the OpenEduCat grievance
-- flow: a reference number, a two-level category, and a lifecycle of
-- draft -> submitted -> in_progress -> resolved | rejected.
--
-- Nothing here is guarded by phase1_sensitive_write_guard — that trigger
-- is installed only on the tables named in
-- 20260905120000_phase1_security_enforcement.sql, and this is a new one.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.grievances (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Per-org human reference, e.g. GRV-0001. Assigned by trigger.
  reference       text,
  -- Who raised it (a student or a parent profile).
  raised_by       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Which student it concerns. Set when a parent raises on a child's
  -- behalf, or when the raiser is the student. Nullable so a grievance
  -- survives the student record being removed.
  student_id      uuid        REFERENCES public.students(id) ON DELETE SET NULL,

  subject         text        NOT NULL,
  description     text,
  -- Top level: 'academic' | 'non_academic'. Free sub-label beneath it
  -- (e.g. 'Grades Issues', 'Transport facility') so schools are not
  -- boxed into a fixed list.
  category        text        NOT NULL DEFAULT 'academic',
  subcategory     text,

  status          text        NOT NULL DEFAULT 'draft',
  priority        text        NOT NULL DEFAULT 'normal',

  -- Staff response.
  resolution      text,
  resolved_by     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at     timestamptz,

  submitted_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT grievances_category_chk
    CHECK (category IN ('academic', 'non_academic')),
  CONSTRAINT grievances_status_chk
    CHECK (status IN ('draft', 'submitted', 'in_progress', 'resolved', 'rejected')),
  CONSTRAINT grievances_priority_chk
    CHECK (priority IN ('low', 'normal', 'high')),
  CONSTRAINT grievances_reference_org_uq UNIQUE (organization_id, reference)
);

CREATE INDEX IF NOT EXISTS grievances_org_status_idx
  ON public.grievances (organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS grievances_raised_by_idx
  ON public.grievances (raised_by, created_at DESC);
CREATE INDEX IF NOT EXISTS grievances_student_idx
  ON public.grievances (student_id);


-- ---------------------------------------------------------------------
-- 2. Reference numbering — per-org, atomic.
--    Same advisory-lock pattern as prepare_income_receipt_number()
--    in 20260830000000_atomic_org_finance_numbering.sql.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prepare_grievance_reference()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_org  uuid;
  v_next bigint;
BEGIN
  v_org := COALESCE(NEW.organization_id, public.current_user_org_id());
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'No organization in scope for this grievance'
      USING ERRCODE = '42501';
  END IF;
  NEW.organization_id := v_org;

  IF NEW.reference IS NULL OR btrim(NEW.reference) = '' THEN
    -- Hash collisions only serialize unrelated organizations; they
    -- cannot compromise correctness. Lock lasts through this insert.
    PERFORM pg_advisory_xact_lock(
      hashtextextended('grievance:ref:' || v_org::text, 0)
    );

    SELECT COALESCE(MAX(substring(reference FROM '^GRV-([0-9]+)$')::bigint), 0) + 1
      INTO v_next
      FROM public.grievances
     WHERE organization_id = v_org
       AND reference ~ '^GRV-[0-9]+$';

    NEW.reference := 'GRV-' || lpad(v_next::text, 4, '0');
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_grievances_reference ON public.grievances;
CREATE TRIGGER trg_grievances_reference
  BEFORE INSERT ON public.grievances
  FOR EACH ROW EXECUTE FUNCTION public.prepare_grievance_reference();


-- Keep updated_at honest, and stamp the lifecycle timestamps.
CREATE OR REPLACE FUNCTION public.touch_grievance()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();

  IF NEW.status = 'submitted' AND COALESCE(OLD.status, '') <> 'submitted'
     AND NEW.submitted_at IS NULL THEN
    NEW.submitted_at := now();
  END IF;

  IF NEW.status IN ('resolved', 'rejected')
     AND COALESCE(OLD.status, '') NOT IN ('resolved', 'rejected') THEN
    NEW.resolved_at := COALESCE(NEW.resolved_at, now());
    NEW.resolved_by := COALESCE(NEW.resolved_by, auth.uid());
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_grievances_touch ON public.grievances;
CREATE TRIGGER trg_grievances_touch
  BEFORE UPDATE ON public.grievances
  FOR EACH ROW EXECUTE FUNCTION public.touch_grievance();


-- ---------------------------------------------------------------------
-- 3. RLS
--    Policies are dropped by name and recreated, so this file is the
--    single source of truth for this table and re-running it cannot
--    accumulate widening policies (see CLAUDE.md §5 on OR-combining).
-- ---------------------------------------------------------------------
ALTER TABLE public.grievances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS grievances_select ON public.grievances;
DROP POLICY IF EXISTS grievances_insert ON public.grievances;
DROP POLICY IF EXISTS grievances_update ON public.grievances;
DROP POLICY IF EXISTS grievances_delete ON public.grievances;

-- Read: staff see the whole org's queue; a student or parent sees only
-- what they raised, or what concerns a student they are linked to.
CREATE POLICY grievances_select ON public.grievances
  FOR SELECT USING (
    organization_id = public.current_user_org_id()
    AND (
      public.is_staff_user()
      OR raised_by = auth.uid()
      OR student_id IN (SELECT student_id FROM public.my_linked_student_ids())
    )
  );

-- Write: the raiser is always the caller, and the row is stamped with
-- the caller's own org. A parent may only file against a linked child.
CREATE POLICY grievances_insert ON public.grievances
  FOR INSERT WITH CHECK (
    organization_id = public.current_user_org_id()
    AND raised_by = auth.uid()
    AND (
      student_id IS NULL
      OR public.is_staff_user()
      OR student_id IN (SELECT student_id FROM public.my_linked_student_ids())
    )
  );

-- Update: staff triage and resolve anything in their org. The raiser may
-- keep editing only while it is still a draft — once submitted it is the
-- school's record, not theirs to rewrite.
CREATE POLICY grievances_update ON public.grievances
  FOR UPDATE USING (
    organization_id = public.current_user_org_id()
    AND (
      public.is_staff_user()
      OR (raised_by = auth.uid() AND status = 'draft')
    )
  )
  WITH CHECK (
    organization_id = public.current_user_org_id()
    AND (
      public.is_staff_user()
      OR (raised_by = auth.uid() AND status IN ('draft', 'submitted'))
    )
  );

-- Delete: the raiser can discard an unsubmitted draft; admins can remove
-- anything in their own org.
CREATE POLICY grievances_delete ON public.grievances
  FOR DELETE USING (
    organization_id = public.current_user_org_id()
    AND (
      public.is_org_admin(organization_id)
      OR (raised_by = auth.uid() AND status = 'draft')
    )
  );


-- =====================================================================
-- VERIFICATION (read-only) — run after applying.
-- =====================================================================

-- V1. Table exists with RLS enabled.
SELECT 'V1 table' AS check, c.relname, c.relrowsecurity AS rls_enabled
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'grievances';

-- V2. Exactly four policies, one per command (expect 4 rows).
SELECT 'V2 policies' AS check, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'grievances'
ORDER BY cmd;

-- V3. anon has no access to the table (expect 0 rows).
SELECT 'V3 anon access' AS check, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'grievances' AND grantee = 'anon';

-- V4. Both triggers are attached (expect 2 rows).
SELECT 'V4 triggers' AS check, tgname
FROM pg_trigger
WHERE tgrelid = 'public.grievances'::regclass AND NOT tgisinternal
ORDER BY tgname;
