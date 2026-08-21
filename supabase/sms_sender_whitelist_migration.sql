-- Allowed sender list for SMS processing.
-- Comma-separated names or numbers. If empty, all senders are accepted.
-- Matching is case-insensitive and partial (e.g. "gtbank" matches "GTBank Alert").
ALTER TABLE school_settings
ADD COLUMN IF NOT EXISTS sms_allowed_senders text DEFAULT '';
