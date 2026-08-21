-- Auto-expense toggle: when ON, DR bank alerts automatically create expense entries
ALTER TABLE school_settings
ADD COLUMN IF NOT EXISTS sms_auto_expense boolean NOT NULL DEFAULT false;
