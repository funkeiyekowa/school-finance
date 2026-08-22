-- ============================================================
-- AUTO-CREDIT POLICY — Explainable Policy Engine
-- Run this in the Supabase SQL editor.
--
-- Adds a jsonb policy column to school_settings and a dedicated
-- policy_audit_log table that records every policy change.
-- ============================================================

-- ---------- Policy storage on school_settings ----------
ALTER TABLE school_settings
  -- The full auto-credit policy as a JSON object. Replaces the old
  -- sms_auto_credit_min_confidence scalar. The policy engine reads this
  -- on every alert; if null it falls back to the balanced preset.
  ADD COLUMN IF NOT EXISTS auto_credit_policy jsonb;

-- ---------- Policy audit log ----------
-- Every change to the auto-credit policy is recorded here so
-- administrators can see who changed what and when.
CREATE TABLE IF NOT EXISTS policy_audit_log (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  changed_by_email text,
  changed_by_name text,
  changed_at timestamptz DEFAULT now(),
  previous_policy jsonb,
  new_policy jsonb,
  preset_name text,
  changes_summary text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_policy_audit_changed_at
  ON policy_audit_log(changed_at DESC);

-- ---------- Migrate existing threshold to the new model ----------
-- If the school previously had a custom threshold in
-- sms_auto_credit_min_confidence, seed the new policy with that value
-- as the minimumConfidence rather than silently ignoring it.
DO $$
DECLARE
  old_threshold numeric;
BEGIN
  SELECT sms_auto_credit_min_confidence INTO old_threshold
  FROM school_settings LIMIT 1;

  IF old_threshold IS NOT NULL AND old_threshold > 0 THEN
    UPDATE school_settings
    SET auto_credit_policy = jsonb_build_object(
      'preset', 'balanced',
      'minimumConfidence', ROUND(old_threshold * 100),
      'allowExactCode', true,
      'allowThreeExactNames', true,
      'allowTwoExactNames', true,
      'allowExactPlusPrefix', true,
      'allowSingleName', false,
      'allowFuzzyOnly', false,
      'requireAmount', true,
      'requireCreditDirection', true,
      'requireUniqueCandidate', true,
      'blockDuplicates', true,
      'blockAmbiguous', true,
      'blockConflicts', true
    )
    WHERE auto_credit_policy IS NULL;
  END IF;
END $$;
