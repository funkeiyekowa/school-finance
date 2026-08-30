-- Atomic, organization-scoped receipt and voucher numbering.
--
-- Prerequisite: multi_tenant_migration.sql (organizations, org_memberships,
-- current_user_org_id(), and organization_id columns) must already be applied.
-- Safe to re-run. Historical identifiers are never rewritten.

DO $$
BEGIN
  IF to_regprocedure('public.current_user_org_id()') IS NULL THEN
    RAISE EXCEPTION
      'current_user_org_id() not found; apply multi_tenant_migration.sql first';
  END IF;

  IF to_regclass('public.income_entries') IS NULL
     OR to_regclass('public.expense_entries') IS NULL THEN
    RAISE EXCEPTION
      'finance tables not found; apply schema.sql before this migration';
  END IF;
END $$;

-- Remove the original global uniqueness so separate organizations can use the
-- same human-facing number. Keep any already-installed org-scoped indexes.
ALTER TABLE public.income_entries
  DROP CONSTRAINT IF EXISTS income_entries_receipt_no_key;
DROP INDEX IF EXISTS public.income_entries_receipt_no_key;

ALTER TABLE public.expense_entries
  DROP CONSTRAINT IF EXISTS expense_entries_voucher_no_key;
DROP INDEX IF EXISTS public.expense_entries_voucher_no_key;

-- Mark pre-migration rows as legacy. This lets the future-row unique indexes
-- be installed even when historical data contains same-org duplicates.
ALTER TABLE public.income_entries
  ADD COLUMN IF NOT EXISTS numbering_generation smallint;
ALTER TABLE public.expense_entries
  ADD COLUMN IF NOT EXISTS numbering_generation smallint;

UPDATE public.income_entries
SET numbering_generation = 0
WHERE numbering_generation IS NULL;

UPDATE public.expense_entries
SET numbering_generation = 0
WHERE numbering_generation IS NULL;

ALTER TABLE public.income_entries
  ALTER COLUMN numbering_generation SET DEFAULT 1,
  ALTER COLUMN numbering_generation SET NOT NULL;
ALTER TABLE public.expense_entries
  ALTER COLUMN numbering_generation SET DEFAULT 1,
  ALTER COLUMN numbering_generation SET NOT NULL;

-- These indexes are guaranteed not to collide with legacy duplicates. The
-- trigger below additionally checks against every legacy row, not only rows
-- covered by these indexes.
CREATE UNIQUE INDEX IF NOT EXISTS uq_income_org_receipt_current
  ON public.income_entries (organization_id, receipt_no)
  WHERE numbering_generation = 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_org_voucher_current
  ON public.expense_entries (organization_id, voucher_no)
  WHERE numbering_generation = 1;

CREATE OR REPLACE FUNCTION public.prepare_income_receipt_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid;
  v_next bigint;
BEGIN
  v_org := COALESCE(NEW.organization_id, public.current_user_org_id());
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'No default organization is available for receipt allocation'
      USING ERRCODE = '42501';
  END IF;

  NEW.organization_id := v_org;
  IF TG_OP = 'INSERT' THEN
    NEW.numbering_generation := 1;
  END IF;

  -- Hash collisions only serialize unrelated organizations; they cannot
  -- compromise correctness. The lock lasts through the surrounding insert.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('finance:receipt:' || v_org::text, 0)
  );

  IF NEW.receipt_no IS NULL OR btrim(NEW.receipt_no) = '' THEN
    SELECT COALESCE(MAX(substring(receipt_no FROM '^RCT-([0-9]+)$')::bigint), 0) + 1
      INTO v_next
      FROM public.income_entries
     WHERE organization_id = v_org
       AND receipt_no ~ '^RCT-[0-9]+$';

    NEW.receipt_no := 'RCT-' || lpad(v_next::text, 4, '0');
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.income_entries existing
     WHERE existing.organization_id = v_org
       AND existing.receipt_no = NEW.receipt_no
       AND existing.id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'Receipt number % already exists in this organization', NEW.receipt_no
      USING ERRCODE = '23505', CONSTRAINT = 'uq_income_org_receipt_current';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_expense_voucher_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid;
  v_next bigint;
BEGIN
  v_org := COALESCE(NEW.organization_id, public.current_user_org_id());
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'No default organization is available for voucher allocation'
      USING ERRCODE = '42501';
  END IF;

  NEW.organization_id := v_org;
  IF TG_OP = 'INSERT' THEN
    NEW.numbering_generation := 1;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('finance:voucher:' || v_org::text, 0)
  );

  IF NEW.voucher_no IS NULL OR btrim(NEW.voucher_no) = '' THEN
    SELECT COALESCE(MAX(substring(voucher_no FROM '^VCH-([0-9]+)$')::bigint), 0) + 1
      INTO v_next
      FROM public.expense_entries
     WHERE organization_id = v_org
       AND voucher_no ~ '^VCH-[0-9]+$';

    NEW.voucher_no := 'VCH-' || lpad(v_next::text, 4, '0');
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.expense_entries existing
     WHERE existing.organization_id = v_org
       AND existing.voucher_no = NEW.voucher_no
       AND existing.id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'Voucher number % already exists in this organization', NEW.voucher_no
      USING ERRCODE = '23505', CONSTRAINT = 'uq_expense_org_voucher_current';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prepare_income_receipt_number
  ON public.income_entries;
CREATE TRIGGER trg_prepare_income_receipt_number
BEFORE INSERT OR UPDATE OF receipt_no, organization_id
ON public.income_entries
FOR EACH ROW
EXECUTE FUNCTION public.prepare_income_receipt_number();

DROP TRIGGER IF EXISTS trg_prepare_expense_voucher_number
  ON public.expense_entries;
CREATE TRIGGER trg_prepare_expense_voucher_number
BEFORE INSERT OR UPDATE OF voucher_no, organization_id
ON public.expense_entries
FOR EACH ROW
EXECUTE FUNCTION public.prepare_expense_voucher_number();

-- Report historical duplicates without aborting or modifying them. New writes
-- cannot add another duplicate because they pass through the locked triggers.
DO $$
DECLARE
  v_income_duplicate_groups bigint;
  v_expense_duplicate_groups bigint;
BEGIN
  SELECT count(*) INTO v_income_duplicate_groups
  FROM (
    SELECT organization_id, receipt_no
    FROM public.income_entries
    GROUP BY organization_id, receipt_no
    HAVING count(*) > 1
  ) duplicates;

  SELECT count(*) INTO v_expense_duplicate_groups
  FROM (
    SELECT organization_id, voucher_no
    FROM public.expense_entries
    GROUP BY organization_id, voucher_no
    HAVING count(*) > 1
  ) duplicates;

  IF v_income_duplicate_groups > 0 OR v_expense_duplicate_groups > 0 THEN
    RAISE WARNING
      'Preserved legacy finance duplicates (receipt groups: %, voucher groups: %). New duplicates are blocked.',
      v_income_duplicate_groups, v_expense_duplicate_groups;
  END IF;
END $$;
