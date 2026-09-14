-- ============================================================
-- Drop stale/undocumented activity_log policies
-- ============================================================
-- FOLLOW-UP to 20260912000003_fix_activity_log_rls.sql.
--
-- After applying that migration, a live pg_policies check on
-- activity_log turned up two policies that do not exist in ANY
-- tracked migration in this repo:
--
--   "Admins can read activity log"  (SELECT, no organization_id check)
--   "Developer can delete activity" (DELETE, no organization_id check)
--
-- ROOT CAUSE (SELECT): schema.sql originally created a policy named
-- "Admins can read activity log". tenant_isolation_enforcement.sql
-- later tried to remove it with:
--   DROP POLICY IF EXISTS "Admin can read activity" ON activity_log;
-- — a name that does NOT match ("Admin" vs "Admins", "activity" vs
-- "activity log"). DROP POLICY IF EXISTS silently no-ops on a
-- non-matching name, so the original wide-open policy survived
-- alongside tenant_activity_select. Because Postgres RLS policies are
-- OR'd together, this policy alone granted every profiles.role='admin'
-- user (at ANY org) unscoped read access to activity_log, regardless
-- of the new org-scoped policy — the same failure mode fix_rls_leaks.sql
-- documented and fixed for expense_entries/vendors/sms_inbox, just
-- never applied here.
--
-- ROOT CAUSE (DELETE): "Developer can delete activity" does not appear
-- in any file in this repository. It is not part of the documented
-- design (activity_log has always been append-only — no DELETE policy
-- was ever defined in a tracked migration) and was most likely applied
-- directly against the database by a tool other than this codebase's
-- migration history. It granted unscoped cross-org delete to any
-- profiles.role='developer' user.
--
-- FIX: drop both. No replacement is added:
--   - SELECT is already correctly covered by tenant_activity_select
--     (org-scoped for ordinary users, is_platform_admin() for NULL
--     rows) — dropping the stale duplicate removes only the leak, no
--     legitimate access is lost.
--   - DELETE capability is intentionally not replaced. It was never
--     part of the documented design; if delete access for developers
--     is genuinely needed, that should be a deliberate, separately
--     reviewed policy, not a reinstated guess.
--
-- Idempotent — safe to re-run. Run in Supabase SQL editor when
-- explicitly authorized. NOT applied here.
-- ============================================================

DROP POLICY IF EXISTS "Admins can read activity log" ON public.activity_log;
DROP POLICY IF EXISTS "Developer can delete activity" ON public.activity_log;

-- ------------------------------------------------------------
-- Verification
-- ------------------------------------------------------------
-- Should return exactly 2 rows: tenant_activity_insert, tenant_activity_select.
-- No SELECT or DELETE policy referencing profiles.role should remain.
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'activity_log'
ORDER BY policyname;
