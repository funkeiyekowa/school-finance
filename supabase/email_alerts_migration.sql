-- ============================================================
-- EMAIL ALERTS — Gmail → webhook pipeline
-- Run this whole block in the Supabase SQL editor.
-- ============================================================

-- ---------- Settings for the email channel ----------
ALTER TABLE school_settings
  ADD COLUMN IF NOT EXISTS email_alerts_enabled boolean NOT NULL DEFAULT false,
  -- Comma-separated from-addresses the Apps Script should look at.
  ADD COLUMN IF NOT EXISTS email_allowed_senders text DEFAULT '',
  -- Comma-separated subject keywords (any match wins). Blank = any subject.
  ADD COLUMN IF NOT EXISTS email_subject_keywords text DEFAULT '',
  -- Gmail label the filter applies to bank alerts.
  ADD COLUMN IF NOT EXISTS email_gmail_label text DEFAULT 'BankAlerts',
  -- Label applied by the script once an email has been forwarded, so it
  -- is never sent twice.
  ADD COLUMN IF NOT EXISTS email_processed_label text DEFAULT 'BankAlerts/Processed',
  -- Shared secret: the Apps Script must present this to be trusted.
  ADD COLUMN IF NOT EXISTS email_webhook_secret text,
  -- How many messages the script may forward per run.
  ADD COLUMN IF NOT EXISTS email_max_per_run integer NOT NULL DEFAULT 25,
  -- Health/telemetry, written by the webhook.
  ADD COLUMN IF NOT EXISTS email_last_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_total_received integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS email_last_sync_at timestamptz;

-- Give the existing row a secret so the Setup screen has one to show.
UPDATE school_settings
SET email_webhook_secret = encode(gen_random_bytes(24), 'hex')
WHERE email_webhook_secret IS NULL;

-- ---------- Track which channel each alert arrived on ----------
ALTER TABLE sms_inbox
  ADD COLUMN IF NOT EXISTS source_channel text NOT NULL DEFAULT 'sms',
  ADD COLUMN IF NOT EXISTS email_subject text;

CREATE INDEX IF NOT EXISTS idx_sms_inbox_source_channel
  ON sms_inbox(source_channel);

-- Cross-channel dedupe reads amount + created_at on every alert, so index them.
CREATE INDEX IF NOT EXISTS idx_sms_inbox_amount_created
  ON sms_inbox(parsed_amount, created_at DESC);

-- Backfill: everything already stored arrived by SMS.
UPDATE sms_inbox SET source_channel = 'sms' WHERE source_channel IS NULL;
