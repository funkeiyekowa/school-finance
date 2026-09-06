-- =====================================================================
-- FIX: students stuck on "Set Your New Password" after already
--      completing it (must_change_password never cleared on students).
-- =====================================================================
-- Context: clear_must_change_password() (see
--   fix_student_clear_must_change_password.sql) now correctly clears
--   BOTH profiles.must_change_password AND students.must_change_password
--   for the caller (auth.uid()). That fix is live.
--
-- This migration backfills students who got stuck BEFORE that fix
-- shipped: their profiles flag was already cleared (proof they went
-- through the change-password flow under the OLD, incomplete RPC),
-- but their students flag never was, because the old RPC only touched
-- profiles. They are stuck in an infinite "Set Your New Password" loop
-- despite having already set one.
--
-- SAFE BY CONSTRUCTION: only touches a student row when
--   students.must_change_password = TRUE
--   AND the linked profiles.must_change_password = FALSE
-- i.e. only students who have DEMONSTRABLY already been through the
-- flow at least once. A student who has never attempted it still has
-- BOTH flags TRUE and is correctly left untouched (they still need to
-- change their default password).
--
-- Idempotent. Safe to re-run.
-- =====================================================================

BEGIN;

-- Diagnostic (before): how many students are affected.
SELECT 'BEFORE: students stuck (profile cleared, student flag stuck)' AS metric, COUNT(*) AS n
FROM public.students s
JOIN public.profiles p ON p.id = s.profile_id
WHERE s.must_change_password = TRUE
  AND p.must_change_password = FALSE;

-- The actual backfill.
UPDATE public.students s
   SET must_change_password = FALSE
  FROM public.profiles p
 WHERE p.id = s.profile_id
   AND s.must_change_password = TRUE
   AND p.must_change_password = FALSE;

-- Diagnostic (after): should be 0.
SELECT 'AFTER: students stuck (should be 0)' AS metric, COUNT(*) AS n
FROM public.students s
JOIN public.profiles p ON p.id = s.profile_id
WHERE s.must_change_password = TRUE
  AND p.must_change_password = FALSE;

-- Aggregate sanity: students genuinely still needing to change their
-- default password (both flags true — untouched by this migration).
SELECT 'Students still needing first password change (expected, untouched)' AS metric, COUNT(*) AS n
FROM public.students s
JOIN public.profiles p ON p.id = s.profile_id
WHERE s.must_change_password = TRUE
  AND p.must_change_password = TRUE;

COMMIT;
