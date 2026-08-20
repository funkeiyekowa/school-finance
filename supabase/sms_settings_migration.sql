-- Add SMS gateway settings columns to school_settings
ALTER TABLE school_settings
ADD COLUMN IF NOT EXISTS sms_gateway_url text,
ADD COLUMN IF NOT EXISTS sms_gateway_username text,
ADD COLUMN IF NOT EXISTS sms_gateway_password text,
ADD COLUMN IF NOT EXISTS sms_gateway_device_id text,
ADD COLUMN IF NOT EXISTS sms_auto_credit boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS sms_auto_credit_min_confidence numeric(4,2) DEFAULT 0.80,
ADD COLUMN IF NOT EXISTS sms_webhook_secret text;
