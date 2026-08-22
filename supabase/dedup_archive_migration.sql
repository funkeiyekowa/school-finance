-- ============================================================
-- PAYMENT ALERT DEDUPLICATION & ARCHIVE SYSTEM
-- Run this in the Supabase SQL editor.
--
-- Adds soft-archive columns to sms_inbox so duplicate alerts
-- can be linked to a primary transaction and removed from the
-- active workflow without being permanently deleted.
-- Also adds a configurable duplicate detection window.
-- ============================================================

-- ---------- Archive columns on sms_inbox ----------
ALTER TABLE sms_inbox
  -- Archive lifecycle state. NULL or 'ACTIVE' means visible in the main workflow.
  ADD COLUMN IF NOT EXISTS archive_status text DEFAULT 'ACTIVE',
  -- FK to the primary alert when this is a confirmed duplicate.
  ADD COLUMN IF NOT EXISTS primary_alert_id uuid REFERENCES sms_inbox(id) ON DELETE SET NULL,
  -- When the record was archived.
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  -- Who archived it (null = system/automatic).
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  -- Human-readable reason.
  ADD COLUMN IF NOT EXISTS archive_reason text,
  -- The duplicate detection confidence score (0-100).
  ADD COLUMN IF NOT EXISTS duplicate_confidence integer,
  -- Structured evidence JSON explaining why the system decided this is a duplicate.
  ADD COLUMN IF NOT EXISTS duplicate_evidence jsonb;

-- Index for the main query: active alerts only (excludes archived).
CREATE INDEX IF NOT EXISTS idx_sms_inbox_archive_status
  ON sms_inbox(archive_status);

-- Index for finding duplicates linked to a primary alert.
CREATE INDEX IF NOT EXISTS idx_sms_inbox_primary_alert
  ON sms_inbox(primary_alert_id)
  WHERE primary_alert_id IS NOT NULL;

-- ---------- Configurable duplicate window in school_settings ----------
ALTER TABLE school_settings
  ADD COLUMN IF NOT EXISTS duplicate_window_minutes integer NOT NULL DEFAULT 10,
  -- Minimum score for automatic archival as PLATFORM_DUPLICATE.
  ADD COLUMN IF NOT EXISTS duplicate_auto_archive_threshold integer NOT NULL DEFAULT 150,
  -- Minimum score for flagging as POSSIBLE_DUPLICATE (below auto-archive).
  ADD COLUMN IF NOT EXISTS duplicate_possible_threshold integer NOT NULL DEFAULT 80;

-- ---------- Backfill: all existing rows are ACTIVE ----------
UPDATE sms_inbox
SET archive_status = 'ACTIVE'
WHERE archive_status IS NULL;

-- ---------- Migrate existing "duplicate" match_status to the new model ----------
-- Records previously marked as match_status='duplicate' by the old dedupe
-- logic should become archive_status='PLATFORM_DUPLICATE' so they move
-- to the archive. Their match_status is reset to what it would have been
-- (needs_review) since the duplicate decision is now tracked separately.
UPDATE sms_inbox
SET archive_status = 'PLATFORM_DUPLICATE',
    archived_at = updated_at,
    archive_reason = 'Migrated from legacy match_status=duplicate'
WHERE match_status = 'duplicate'
  AND archive_status = 'ACTIVE';

-- NOTE: We intentionally do NOT change match_status on migrated rows here
-- because the UI may still reference it. The new UI will filter on
-- archive_status instead.
