-- ============================================================
-- EMAIL ALERTS — fixes for the Gmail pipeline
-- Run this whole block in the Supabase SQL editor.
--
-- Adds a history cutoff so the Apps Script can be pointed at a label
-- containing years of old bank alerts without back-posting all of them.
-- ============================================================

ALTER TABLE school_settings
  -- Only alerts received on or after this date are forwarded and posted.
  -- Without this, enabling a label holding thousands of historical alerts
  -- would replay years of transactions into the ledger.
  ADD COLUMN IF NOT EXISTS email_start_date date,
  -- Emails the script forwarded but the app rejected, for visibility.
  ADD COLUMN IF NOT EXISTS email_total_rejected integer NOT NULL DEFAULT 0;

-- Default the cutoff to today so an existing install can't retroactively
-- ingest its own history the first time the fixed script runs.
UPDATE school_settings
SET email_start_date = CURRENT_DATE
WHERE email_start_date IS NULL;
