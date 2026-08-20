-- Tracks the live state of the registered SMS Gate webhook so the
-- Setup UI can show "Connected" / "Not connected" without re-querying
-- the SMS Gate API on every page load.
ALTER TABLE school_settings
ADD COLUMN IF NOT EXISTS sms_webhook_id text,
ADD COLUMN IF NOT EXISTS sms_webhook_registered_at timestamptz,
ADD COLUMN IF NOT EXISTS sms_gateway_provider text DEFAULT 'sms-gate.app';
