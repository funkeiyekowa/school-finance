-- ============================================================
-- Add a `demoted` count column to promotion_batches
-- ============================================================
-- The promotion UI supports demoting students (moving them a class
-- down after a review) alongside the original promote/repeat/graduate
-- flow. The batch summary row previously had no dedicated column for
-- this count and stashed it in `notes` as free text, which meant the
-- batch history list couldn't render a real per-batch demotion total.
-- Adding the column is additive and non-breaking — existing rows keep
-- `demoted = 0`, and per-student history (which is the audit source of
-- truth) already lives in promotion_events(action='demoted').
--
-- Idempotent: safe to run more than once.
-- ============================================================

ALTER TABLE public.promotion_batches
  ADD COLUMN IF NOT EXISTS demoted integer NOT NULL DEFAULT 0;

-- Backfill legacy rows that recorded the count in notes as
-- "<N> student(s) demoted". Best-effort — rows where the format
-- differs will just stay at 0 (the promotion_events table is still
-- the authoritative per-student record).
UPDATE public.promotion_batches
   SET demoted = COALESCE((regexp_match(notes, '^(\d+) student'))[1]::int, 0)
 WHERE demoted = 0
   AND notes ~ '^\d+ student\(s\) demoted$';

-- Sanity: rows should never have a negative count.
ALTER TABLE public.promotion_batches
  DROP CONSTRAINT IF EXISTS promotion_batches_demoted_nonneg;
ALTER TABLE public.promotion_batches
  ADD CONSTRAINT promotion_batches_demoted_nonneg CHECK (demoted >= 0);
