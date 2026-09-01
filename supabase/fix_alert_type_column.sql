-- ============================================================================
-- Add an explicit alert_type column to sms_inbox
-- ============================================================================
-- The Payment Alerts screen was inferring income vs. expense from
-- `parser_version === "v3-expense"`. The backend moved to a v4 parser and
-- started writing `parser_version = "v4-expense"` for real expenses, but the
-- frontend check was never updated — so every genuine expense/debit alert
-- (including ones that are correctly detected as debits by the parser) fails
-- that string match and renders, and worse, POSTS, as income.
--
-- Root cause: an important business fact (income vs expense) was being
-- inferred from a free-text diagnostic string instead of being stored
-- explicitly. This migration adds a real column for it.
-- ============================================================================

ALTER TABLE sms_inbox
  ADD COLUMN IF NOT EXISTS alert_type text
  CHECK (alert_type IN ('income', 'expense'));

CREATE INDEX IF NOT EXISTS idx_sms_inbox_alert_type
  ON sms_inbox(organization_id, alert_type);

-- Backfill existing rows from parser_version so history isn't left blank.
-- This corrects the DISPLAY bug retroactively (any row whose parser_version
-- shows it was really a debit will now show as Expense). It cannot retroactively
-- fix rows where the parser's direction detection itself returned "unknown" and
-- was silently posted as income by the old dispatch logic in processor.ts
-- (see the code fix alongside this migration) — those rows are indistinguishable
-- from real credits by parser_version alone and need a manual audit of
-- message_text for genuine debit wording ("DebitAlert", "Transfer to", "POS",
-- vendor-style descriptions) if you suspect any exist.
UPDATE sms_inbox
SET alert_type = CASE
  WHEN parser_version IN ('v3-expense', 'v4-expense') THEN 'expense'
  ELSE 'income'
END
WHERE alert_type IS NULL;
