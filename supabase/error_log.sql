-- ============================================================
-- Structured error log table for the application
-- ============================================================
-- Populated by src/lib/errors/logError.ts when a server-side or
-- webhook error occurs, and by the global error boundary for
-- client-side errors that bubble to the shell. Storing errors in
-- the database (rather than only writing them to Vercel's log
-- stream) means:
--
--   • The admin can review recent failures inside the app instead
--     of needing hosting-provider access.
--   • Rate-limit trips on public webhooks land here so a
--     misconfigured caller or an active abuse attempt is visible
--     without waiting for a bill spike.
--   • A future Sentry / OpenTelemetry backend can be dropped in
--     without changing how the app reports.
--
-- The seam is deliberately additive: logError() best-efforts the
-- write and never throws, so an error in the error logger itself
-- can't crash a webhook or a page render.
--
-- Idempotent; safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.error_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  source          text NOT NULL,                -- e.g. 'sms-webhook', 'email-webhook', 'ui:global-error'
  severity        text NOT NULL DEFAULT 'error',-- 'error' | 'warn' | 'info'
  message         text NOT NULL,
  stack           text,
  context         jsonb DEFAULT '{}'::jsonb,    -- arbitrary structured payload (request id, user id, etc.)
  request_ip      text,
  request_path    text,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_error_log_created_at ON public.error_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_log_source     ON public.error_log (source);
CREATE INDEX IF NOT EXISTS idx_error_log_org        ON public.error_log (organization_id);

-- Retain 90 days by default; a follow-up cron can prune older rows.
-- Kept out of this migration so the retention window is configurable
-- per school without a schema change.

ALTER TABLE public.error_log ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------
-- RLS
-- --------------------------------------------------------------
-- Writes come exclusively from the service-role client (server-side
-- routes and edge handlers), so anon and authenticated identities
-- have NO write policy. Reads are restricted to super-admins for
-- now; a per-org policy can be added later if we want each school
-- admin to see their own failures.
DROP POLICY IF EXISTS error_log_super_read ON public.error_log;
CREATE POLICY error_log_super_read
  ON public.error_log
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'super_admin' OR p.role = 'developer')
    )
  );

-- No INSERT / UPDATE / DELETE policies for authenticated or anon.
-- The service-role key bypasses RLS, which is how logError() writes.

-- --------------------------------------------------------------
-- Helper RPC: prune old rows
-- --------------------------------------------------------------
-- Call from an ops cron: SELECT public.prune_error_log(90);
CREATE OR REPLACE FUNCTION public.prune_error_log(retain_days integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted integer;
BEGIN
  DELETE FROM public.error_log
   WHERE created_at < now() - make_interval(days => retain_days)
   RETURNING 1 INTO deleted;
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END $$;

REVOKE ALL ON FUNCTION public.prune_error_log(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_error_log(integer) TO service_role;
