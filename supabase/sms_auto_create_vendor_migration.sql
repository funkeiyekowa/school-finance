-- ============================================================
-- Payment Alerts: "Auto-create vendor" flag
-- ============================================================
-- Run order: after saas_foundation.sql and sms_auto_expense_migration.sql
--   (both already in supabase/README.md's run order). Idempotent — safe
--   to re-run.
--
-- Adds a single per-school setting, school_settings.sms_auto_create_vendor.
-- When ON, a debit (DR) bank alert whose payee does NOT match an existing
-- vendor will have a vendor record created automatically (in the vendors
-- table) and the resulting expense linked to it. When OFF (the default),
-- behaviour is unchanged: the expense is still recorded under the payee
-- name, but no new vendor row is created.
--
-- The actual vendor row creation happens in application code
-- (src/lib/alerts/processor.ts, running under the service role), the same
-- place the expense/income ledger rows are written. This migration only
-- introduces the toggle the code reads. No RLS changes — this is a plain
-- boolean column on an existing, already-tenant-scoped table.

ALTER TABLE school_settings
  ADD COLUMN IF NOT EXISTS sms_auto_create_vendor boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN school_settings.sms_auto_create_vendor IS
  'When true, debit bank alerts with an unknown payee auto-create a vendor record instead of only recording the expense under the payee name.';

-- ------------------------------------------------------------
-- Verification
-- ------------------------------------------------------------
-- 1. Column exists with the expected type/default.
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'school_settings'
  AND column_name = 'sms_auto_create_vendor';

-- 2. Every existing school row now has the flag (defaulted to false).
SELECT id, organization_id, sms_auto_create_vendor
FROM school_settings
ORDER BY updated_at;
