-- ============================================================
-- CUSTOM AI PROVIDERS — add a new OpenAI-compatible AI provider
-- (base URL + model + which Vercel env var holds its key) from
-- the platform admin UI, with NO code change or redeploy needed
-- for the next one.
--
-- Why this exists: every provider (OpenAI, Groq, Gemini,
-- OpenRouter) was previously a hardcoded entry in
-- src/lib/ai/providers.ts. Adding a 5th one (first request: Z.ai /
-- Zhipu AI, GLM models) meant writing and shipping code again.
-- This table lets a platform admin register any future
-- OpenAI-chat-compatible provider by filling in a form: a slug,
-- a label, its chat-completions base URL, the exact name of the
-- Vercel env var holding its API key (the KEY VALUE itself is
-- never stored here or anywhere in the database — it stays only
-- in Vercel, read at request time by name, same as every built-in
-- provider), and a default model id.
--
-- This migration also seeds Z.ai itself, using the
-- GRANTSCHOOL_Z_API_KEY env var already added in Vercel, so it
-- shows up already configured once this runs. The base URL and
-- default model below are Z.ai's best-known OpenAI-compatible
-- values as of this writing — NOT live-verified (no network
-- access at write time) — use the "Test connection" button on
-- Dashboard -> Platform -> AI Provider right after running this to
-- confirm, and edit the row in "Manage custom providers" on that
-- same page if either needs correcting. No SQL or code change
-- needed to fix it — it's just a row.
--
-- Run order: after saas_foundation.sql (is_platform_admin()) and
-- ai_provider_settings_v2.sql (org_ai_settings,
-- platform_settings.active_ai_model). Idempotent, safe to re-run —
-- re-running will NOT overwrite an admin's edits to the seeded
-- Z.ai row (ON CONFLICT DO NOTHING).
-- ============================================================

-- --------------------------------------------------------------
-- 1. The custom-provider registry table.
--    No API key material is ever stored here — only the NAME of
--    the Vercel env var that holds it, exactly like every
--    built-in provider's apiKeyEnvCandidates already works.
-- --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_ai_custom_providers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key      text NOT NULL UNIQUE,   -- e.g. 'zai' — used as the provider id everywhere (org_ai_settings.active_provider, etc.)
  label             text NOT NULL,          -- e.g. 'Z.ai (GLM)' — shown in every provider picker
  base_url          text NOT NULL,          -- full chat-completions endpoint, e.g. https://api.z.ai/api/paas/v4/chat/completions
  api_key_env_name  text NOT NULL,          -- exact Vercel env var name holding this provider's key, e.g. GRANTSCHOOL_Z_API_KEY
  default_model     text NOT NULL,          -- e.g. glm-4.6 — editable free-text on every provider picker, this is just the pre-fill
  extra_headers     jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled           boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- provider_key must be a plain lowercase slug and must never collide
-- with a built-in provider id — those are handled by hardcoded
-- request/response logic a free-text row here cannot override.
ALTER TABLE public.platform_ai_custom_providers
  DROP CONSTRAINT IF EXISTS custom_ai_providers_key_format_check;
ALTER TABLE public.platform_ai_custom_providers
  ADD CONSTRAINT custom_ai_providers_key_format_check
  CHECK (
    provider_key ~ '^[a-z][a-z0-9_]{1,31}$'
    AND provider_key NOT IN ('openai', 'groq', 'gemini', 'openrouter')
  );

CREATE OR REPLACE FUNCTION public.custom_ai_providers_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_custom_ai_providers_touch ON public.platform_ai_custom_providers;
CREATE TRIGGER trg_custom_ai_providers_touch
  BEFORE UPDATE ON public.platform_ai_custom_providers
  FOR EACH ROW EXECUTE FUNCTION public.custom_ai_providers_touch();

ALTER TABLE public.platform_ai_custom_providers ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated staff member — same reasoning as
-- platform_modules ("modules_read" USING (true)) — nothing here is
-- secret (no key VALUE is stored, only a label/URL/model/env-var-NAME),
-- and every provider picker (platform-wide + per-school) needs to see
-- the full list to render its options.
DROP POLICY IF EXISTS "custom_ai_providers_read" ON public.platform_ai_custom_providers;
CREATE POLICY "custom_ai_providers_read" ON public.platform_ai_custom_providers
  FOR SELECT USING (true);

-- Write: platform admins only.
DROP POLICY IF EXISTS "custom_ai_providers_write" ON public.platform_ai_custom_providers;
CREATE POLICY "custom_ai_providers_write" ON public.platform_ai_custom_providers
  FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

-- --------------------------------------------------------------
-- 2. Widen active_provider validation on platform_settings and
--    org_ai_settings: both previously had a plain CHECK constraint
--    hardcoding the 4 built-in provider ids, which would reject any
--    custom provider_key outright. A CHECK constraint can't safely
--    reference another table, so this replaces each with a
--    BEFORE INSERT OR UPDATE trigger that accepts NULL, one of the
--    4 built-ins, OR any ENABLED platform_ai_custom_providers row.
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_ai_provider_choice(p_provider text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p_provider IS NULL
    OR p_provider IN ('openai', 'groq', 'gemini', 'openrouter')
    OR EXISTS (
      SELECT 1 FROM public.platform_ai_custom_providers
      WHERE provider_key = p_provider AND enabled = true
    );
$$;

-- platform_settings.active_ai_provider
ALTER TABLE public.platform_settings
  DROP CONSTRAINT IF EXISTS platform_settings_active_ai_provider_check;

CREATE OR REPLACE FUNCTION public.validate_platform_settings_provider()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT public.validate_ai_provider_choice(NEW.active_ai_provider) THEN
    RAISE EXCEPTION 'Unknown AI provider "%": not a built-in provider and no enabled custom provider with that key exists', NEW.active_ai_provider;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_platform_settings_provider ON public.platform_settings;
CREATE TRIGGER trg_validate_platform_settings_provider
  BEFORE INSERT OR UPDATE OF active_ai_provider ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.validate_platform_settings_provider();

-- org_ai_settings.active_provider
ALTER TABLE public.org_ai_settings
  DROP CONSTRAINT IF EXISTS org_ai_settings_active_provider_check;

CREATE OR REPLACE FUNCTION public.validate_org_ai_settings_provider()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT public.validate_ai_provider_choice(NEW.active_provider) THEN
    RAISE EXCEPTION 'Unknown AI provider "%": not a built-in provider and no enabled custom provider with that key exists', NEW.active_provider;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_org_ai_settings_provider ON public.org_ai_settings;
CREATE TRIGGER trg_validate_org_ai_settings_provider
  BEFORE INSERT OR UPDATE OF active_provider ON public.org_ai_settings
  FOR EACH ROW EXECUTE FUNCTION public.validate_org_ai_settings_provider();

-- --------------------------------------------------------------
-- 3. Seed Z.ai using the Vercel env var already added
--    (GRANTSCHOOL_Z_API_KEY). ON CONFLICT DO NOTHING so re-running
--    this file never clobbers an admin's later edits to this row.
--    Base URL / default model are best-known values for Z.ai's
--    OpenAI-compatible endpoint — verify with "Test connection"
--    and correct via "Manage custom providers" if needed, no code
--    or SQL change required either way.
-- --------------------------------------------------------------
INSERT INTO public.platform_ai_custom_providers
  (provider_key, label, base_url, api_key_env_name, default_model)
VALUES
  ('zai', 'Z.ai (GLM)', 'https://api.z.ai/api/paas/v4/chat/completions', 'GRANTSCHOOL_Z_API_KEY', 'glm-4.6')
ON CONFLICT (provider_key) DO NOTHING;

-- VERIFY
SELECT provider_key, label, base_url, api_key_env_name, default_model, enabled
FROM public.platform_ai_custom_providers;
