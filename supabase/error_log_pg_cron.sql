-- ============================================================
-- Optional: schedule prune_error_log via pg_cron
-- ============================================================
-- Runs prune_error_log(90) once a day at 03:15 UTC so the
-- error_log table doesn't grow unbounded. Requires the pg_cron
-- extension, which on Supabase is available on the Pro plan
-- and needs to be enabled once from the dashboard
-- (Database → Extensions → pg_cron).
--
-- Idempotent: unschedules any existing job with the same name
-- before rescheduling. Safe to re-run after retention changes.
-- ============================================================

DO $$
DECLARE
  v_job_id integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron is not enabled on this database. Enable it under Database > Extensions in the Supabase dashboard, then re-run this migration.';
    RETURN;
  END IF;

  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'prune_error_log_daily';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;

  PERFORM cron.schedule(
    'prune_error_log_daily',
    '15 3 * * *',
    $cron$SELECT public.prune_error_log(90);$cron$
  );
END $$;
