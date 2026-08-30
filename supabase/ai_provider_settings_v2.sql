-- ============================================================
-- AI PROVIDER SETTINGS v2 — per-school provider/model selection,
-- optional per-school API key override, and usage rollups.
--
-- Builds on ai_provider_settings.sql (platform-wide default) —
-- run that one first if you haven't. This migration is additive:
-- it does not remove platform_settings.active_ai_provider, which
-- stays the platform-wide fallback when a school has not chosen
-- its own provider/model.
--
-- Run order: after ai_provider_settings.sql. Idempotent, safe to
-- re-run. Does not touch RLS on any other table.
--
-- IMPORTANT — key storage: an org's OPTIONAL "bring your own API
-- key" override is stored as an opaque ciphertext blob
-- (override_api_key_ciphertext), encrypted/decrypted in Node using
-- AES-256-GCM with a secret that lives ONLY in Vercel
-- (AI_KEY_ENCRYPTION_SECRET) — Postgres never sees the plaintext
-- key or the encryption secret. RLS blocks every client-side read
-- of this column; it is only ever touched by server routes using
-- the service-role client. Never query org_ai_settings directly
-- from the browser client.
-- ============================================================

-- --------------------------------------------------------------
-- 0. Platform-wide default model (companion to
--    ai_provider_settings.sql's active_ai_provider column — that
--    migration added the provider; this adds the model so a super
--    admin can also pin the platform default to a specific
--    OpenRouter free model, not just a provider).
-- --------------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS active_ai_model text;

-- --------------------------------------------------------------
-- 1. Per-school AI settings
-- --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.org_ai_settings (
  organization_id           uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  active_provider           text,   -- NULL = inherit platform_settings.active_ai_provider
  active_model              text,   -- NULL = provider's default model
  override_api_key_ciphertext text, -- NULL = use the platform's shared key for active_provider
  override_key_added_at     timestamptz,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  updated_by                uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.org_ai_settings
  DROP CONSTRAINT IF EXISTS org_ai_settings_active_provider_check;
ALTER TABLE public.org_ai_settings
  ADD CONSTRAINT org_ai_settings_active_provider_check
  CHECK (active_provider IS NULL OR active_provider IN ('openai', 'groq', 'gemini', 'openrouter'));

CREATE OR REPLACE FUNCTION public.org_ai_settings_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_org_ai_settings_touch ON public.org_ai_settings;
CREATE TRIGGER trg_org_ai_settings_touch
  BEFORE UPDATE ON public.org_ai_settings
  FOR EACH ROW EXECUTE FUNCTION public.org_ai_settings_touch();

ALTER TABLE public.org_ai_settings ENABLE ROW LEVEL SECURITY;

-- No client-side policies at all — every access goes through
-- SECURITY DEFINER RPCs below (for reads that are safe to expose)
-- or the service-role client in server routes (for the ciphertext
-- column). This is deliberate: org_ai_settings is written and read
-- exclusively from trusted server code, never from supabase-js in
-- the browser.

-- --------------------------------------------------------------
-- 2. Read RPC — what a school's admin screen needs to render.
--    Never returns override_api_key_ciphertext. Reports only
--    whether a key override exists (boolean), so the UI can show
--    "using platform key" vs "using your own key" without ever
--    seeing key material.
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_org_ai_settings(p_org uuid)
RETURNS TABLE (
  active_provider text,
  active_model text,
  has_key_override boolean,
  override_key_added_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql SECURITY DEFINER
SET search_path = public AS $$
  SELECT
    s.active_provider,
    s.active_model,
    (s.override_api_key_ciphertext IS NOT NULL) AS has_key_override,
    s.override_key_added_at,
    s.updated_at
  FROM public.org_ai_settings s
  WHERE s.organization_id = p_org
    AND (
      public._is_org_admin_for(p_org)
      OR public._is_platform_super_admin()
    )
  UNION ALL
  -- No row yet for this org — return an all-NULL "inherit everything" row,
  -- but only if the caller is actually authorized to see it.
  SELECT NULL, NULL, false, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.org_ai_settings WHERE organization_id = p_org)
    AND (public._is_org_admin_for(p_org) OR public._is_platform_super_admin())
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_org_ai_settings(uuid) TO authenticated;

-- --------------------------------------------------------------
-- 3. Resolution RPC — used server-side by /api/ai/generate to
--    decide the effective provider+model for a request, in
--    priority order: org override > platform DB toggle > caller
--    passes AI_PROVIDER env var as a last fallback in Node.
--    Callable by any authenticated staff member (read-only, no
--    secrets returned) so the generate route can call it with the
--    user's own session rather than needing service-role for this
--    part.
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_ai_provider_for_org(p_org uuid)
RETURNS TABLE (
  provider text,
  model text,
  has_key_override boolean
)
LANGUAGE sql SECURITY DEFINER
SET search_path = public AS $$
  SELECT
    COALESCE(org.active_provider, plat.active_ai_provider) AS provider,
    -- Only inherit the platform's model choice when the org is ALSO
    -- inheriting the platform's provider — an org's own model choice
    -- never makes sense paired with a different provider's model id.
    COALESCE(org.active_model, CASE WHEN org.active_provider IS NULL THEN plat.active_ai_model END) AS model,
    (org.override_api_key_ciphertext IS NOT NULL) AS has_key_override
  FROM (SELECT 1) dummy
  LEFT JOIN public.org_ai_settings org ON org.organization_id = p_org
  LEFT JOIN public.platform_settings plat ON plat.id = 'default'
$$;

GRANT EXECUTE ON FUNCTION public.resolve_ai_provider_for_org(uuid) TO authenticated;

-- --------------------------------------------------------------
-- 4. Helper: is the caller an admin of this specific org?
--    (org-scoped version of the platform-wide _is_org_admin from
--    admin_delete_and_merge.sql, which checks admin-of-anywhere.)
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._is_org_admin_for(p_org uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_memberships
     WHERE user_id = auth.uid()
       AND organization_id = p_org
       AND role IN ('super_admin', 'owner', 'admin')
  );
$$;

GRANT EXECUTE ON FUNCTION public._is_org_admin_for(uuid) TO authenticated;

-- --------------------------------------------------------------
-- 5. Helper: is the caller a platform super admin (cross-tenant)?
--    Mirrors the check already used by platform_settings' RLS
--    policy in ai_provider_settings.sql / platform_settings_migration.sql.
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._is_platform_super_admin()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = auth.uid() AND p.role IN ('super_admin', 'developer')
  )
  OR EXISTS (
    SELECT 1 FROM public.org_memberships m
     WHERE m.user_id = auth.uid() AND m.role = 'super_admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public._is_platform_super_admin() TO authenticated;

-- --------------------------------------------------------------
-- 6. Per-school usage rollup RPC — reads the existing
--    ai_generation_log (see upgrades_2026_08.sql) grouped by day,
--    so the settings screen can show "N requests today / this
--    month" per school without a new logging table.
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_org_ai_usage(p_org uuid, p_days integer DEFAULT 30)
RETURNS TABLE (
  day date,
  requests integer,
  errors integer,
  tokens_prompt bigint,
  tokens_response bigint
)
LANGUAGE sql SECURITY DEFINER
SET search_path = public AS $$
  SELECT
    date_trunc('day', created_at)::date AS day,
    count(*)::integer AS requests,
    count(*) FILTER (WHERE error IS NOT NULL)::integer AS errors,
    COALESCE(sum(tokens_prompt), 0)::bigint AS tokens_prompt,
    COALESCE(sum(tokens_response), 0)::bigint AS tokens_response
  FROM public.ai_generation_log
  WHERE organization_id = p_org
    AND created_at >= now() - make_interval(days => p_days)
    AND (public._is_org_admin_for(p_org) OR public._is_platform_super_admin())
  GROUP BY 1
  ORDER BY 1 DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_org_ai_usage(uuid, integer) TO authenticated;

-- VERIFY
SELECT id, active_ai_provider, active_ai_model FROM public.platform_settings;
SELECT organization_id, active_provider, active_model, (override_api_key_ciphertext IS NOT NULL) AS has_override
FROM public.org_ai_settings;
