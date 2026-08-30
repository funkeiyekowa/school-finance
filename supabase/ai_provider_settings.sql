-- ============================================================
-- AI PROVIDER SETTINGS — lets a super admin pick which AI backend
-- (openai / groq / gemini / openrouter) is active from the
-- dashboard, instead of only via the AI_PROVIDER env var.
--
-- Adds one column to the existing platform_settings singleton
-- (see platform_settings_migration.sql) rather than a new table,
-- since this is one more global platform-wide knob alongside
-- contact_email/tagline.
--
-- Requires: platform_settings_migration.sql already applied
-- (this ALTERs that table and reuses its RLS policy — no new
-- policy needed here since the existing super_admin/developer
-- policy already covers this new column).
--
-- Run order: after platform_settings_migration.sql. Does not touch
-- RLS on any other table, so it does not need to run after
-- rls_role_scoped_access.sql specifically — but appending it to the
-- end of your run order (after your most recent migration) is
-- simplest and safe.
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS active_ai_provider text;

-- Re-creatable CHECK constraint keeping the column limited to
-- known provider ids (or NULL, meaning "no DB override — fall back
-- to the AI_PROVIDER env var / first configured provider").
ALTER TABLE public.platform_settings
  DROP CONSTRAINT IF EXISTS platform_settings_active_ai_provider_check;

ALTER TABLE public.platform_settings
  ADD CONSTRAINT platform_settings_active_ai_provider_check
  CHECK (active_ai_provider IS NULL OR active_ai_provider IN ('openai', 'groq', 'gemini', 'openrouter'));

-- --------------------------------------------------------------
-- RPC: get_active_ai_provider()
--
-- Any authenticated staff member (not just super admins) can call
-- this — it only returns a short label like 'groq', never a key,
-- so it's not sensitive. This lets /api/ai/generate honor whatever
-- a super admin picked in the dashboard regardless of which staff
-- member's request triggers the actual generation call.
--
-- Writing the column stays gated by platform_settings' existing
-- RLS policy (super_admin / developer only) — this RPC does not
-- change who can write, only who can read the label.
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_active_ai_provider()
RETURNS text
LANGUAGE sql SECURITY DEFINER
SET search_path = public AS $$
  SELECT active_ai_provider FROM public.platform_settings WHERE id = 'default' LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.get_active_ai_provider() TO authenticated;

-- VERIFY
SELECT id, active_ai_provider FROM public.platform_settings;
