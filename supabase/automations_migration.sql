-- ============================================================
-- WORKFLOW & AUTOMATION ENGINE
-- Run this in the Supabase SQL editor.
--
-- Creates:
--   1. automation_rules — configurable trigger → condition → action rules
--   2. automation_logs — execution history for every rule run
-- ============================================================

-- ==========================================================
-- 1. AUTOMATION RULES
-- ==========================================================
CREATE TABLE IF NOT EXISTS automation_rules (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  description text,
  -- Trigger: what event starts this rule
  trigger_event text NOT NULL,
    -- 'payment_received', 'fee_overdue', 'student_absent',
    -- 'student_promoted', 'exam_submitted', 'attendance_recorded',
    -- 'new_student_enrolled', 'balance_threshold', 'scheduled_daily'
  -- Conditions: JSON array of conditions that must ALL be true
  conditions jsonb NOT NULL DEFAULT '[]',
    -- Each: { "field": "amount", "operator": "gt", "value": 5000 }
    -- Operators: eq, neq, gt, gte, lt, lte, contains, not_contains
  -- Actions: JSON array of actions to execute in order
  actions jsonb NOT NULL DEFAULT '[]',
    -- Each: { "type": "send_sms", "template": "...", "to": "parent" }
    -- Types: send_sms, send_email, create_notification, update_field,
    --        assign_fee, log_activity, send_announcement
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 0,          -- Higher = runs first
  execution_count integer NOT NULL DEFAULT 0,
  last_executed_at timestamptz,
  last_status text,                             -- 'success', 'failed', 'skipped'
  created_by text,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automation_rules_org ON automation_rules(organization_id);
CREATE INDEX IF NOT EXISTS idx_automation_rules_trigger ON automation_rules(trigger_event);
CREATE INDEX IF NOT EXISTS idx_automation_rules_enabled ON automation_rules(enabled) WHERE enabled = true;

-- ==========================================================
-- 2. AUTOMATION LOGS — execution history
-- ==========================================================
CREATE TABLE IF NOT EXISTS automation_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  rule_id uuid NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
  rule_name text,
  trigger_event text,
  trigger_data jsonb,                           -- The data that triggered the rule
  conditions_met boolean NOT NULL DEFAULT true,
  actions_executed jsonb,                       -- Results per action
  status text NOT NULL DEFAULT 'success',       -- 'success', 'failed', 'skipped', 'partial'
  error_message text,
  execution_time_ms integer,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automation_logs_rule ON automation_logs(rule_id);
CREATE INDEX IF NOT EXISTS idx_automation_logs_org ON automation_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_automation_logs_created ON automation_logs(created_at DESC);

-- ==========================================================
-- 3. RLS POLICIES
-- ==========================================================
ALTER TABLE automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='automation_rules' AND policyname='ar_read') THEN
    CREATE POLICY "ar_read" ON automation_rules FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='automation_rules' AND policyname='ar_write') THEN
    CREATE POLICY "ar_write" ON automation_rules FOR ALL USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='automation_logs' AND policyname='al_read') THEN
    CREATE POLICY "al_read" ON automation_logs FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='automation_logs' AND policyname='al_write') THEN
    CREATE POLICY "al_write" ON automation_logs FOR ALL USING (true);
  END IF;
END $$;

-- ==========================================================
-- 4. SEED: example automation rules for default org
-- ==========================================================
DO $$
DECLARE
  default_org_id uuid;
BEGIN
  SELECT id INTO default_org_id FROM organizations WHERE slug = 'default' LIMIT 1;
  IF default_org_id IS NOT NULL THEN
    INSERT INTO automation_rules (name, description, trigger_event, conditions, actions, enabled, organization_id) VALUES
    (
      'Payment Receipt Notification',
      'Send a notification when a payment is received above ₦5,000',
      'payment_received',
      '[{"field": "amount", "operator": "gte", "value": 5000}]'::jsonb,
      '[{"type": "create_notification", "message": "Payment of ₦{{amount}} received for {{student_name}}", "to": "parent"}]'::jsonb,
      false,
      default_org_id
    ),
    (
      'Absence Alert',
      'Log activity when a student is marked absent',
      'student_absent',
      '[]'::jsonb,
      '[{"type": "log_activity", "message": "{{student_name}} was marked absent on {{date}}"}]'::jsonb,
      false,
      default_org_id
    ),
    (
      'Fee Overdue Reminder',
      'Create a reminder when student balance exceeds threshold',
      'balance_threshold',
      '[{"field": "balance", "operator": "gt", "value": 10000}]'::jsonb,
      '[{"type": "create_notification", "message": "Outstanding balance of ₦{{balance}} for {{student_name}}", "to": "parent"}]'::jsonb,
      false,
      default_org_id
    )
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
