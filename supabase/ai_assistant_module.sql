-- ============================================================
-- AI Learning Assistant module — admin-configurable, all-roles
-- ============================================================
-- Run order: after saas_foundation.sql (#22) and ai_provider_settings_v2.sql
--   (#60), both already in supabase/README.md. Idempotent — safe to re-run.
--
-- Adds a per-school configuration for an "ask anything" AI assistant that
-- teachers, students, parents and staff can use. An org admin controls:
--   • whether it's on at all (enabled)
--   • which roles may use it (allowed_roles)
--   • a free-text house-rules / policy block injected into the system
--     prompt (custom_rules) — e.g. "Never give direct answers to homework;
--     explain the method instead."
--   • a list of banned topics the assistant must refuse (banned_topics)
--   • a max question length (max_input_chars)
--   • student_safe_mode — extra guardrails for a school-age audience
--
-- The API route (/api/ai/ask) reads this server-side and composes the
-- system prompt. Config that is safe to expose (everything except nothing
-- sensitive lives here — there are no keys in this table) is readable by
-- any member of the org through a SECURITY DEFINER RPC so the UI can show
-- or hide the feature and enforce the same limits client-side.

CREATE TABLE IF NOT EXISTS public.org_assistant_config (
  organization_id   uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  enabled           boolean NOT NULL DEFAULT true,
  -- Roles allowed to use the assistant. Matches org_memberships.role values
  -- plus the pseudo-roles 'student'/'parent' resolved from the profile.
  allowed_roles     text[]  NOT NULL DEFAULT ARRAY['owner','admin','editor','staff','teacher','bursar','accountant','student','parent']::text[],
  custom_rules      text,                 -- admin house rules injected into the system prompt
  banned_topics     text[]  NOT NULL DEFAULT ARRAY[]::text[],
  max_input_chars   integer NOT NULL DEFAULT 2000 CHECK (max_input_chars BETWEEN 100 AND 8000),
  student_safe_mode boolean NOT NULL DEFAULT true,
  updated_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.org_assistant_config ENABLE ROW LEVEL SECURITY;

-- No direct client policies — all access via the RPCs below (read) or the
-- admin write RPC. Keeps the write path gated on _is_org_admin_for().

-- ------------------------------------------------------------
-- Read: any active member of the org may read the (non-sensitive) config,
-- so the client can decide whether to show the assistant and enforce
-- limits. Returns a sensible default row when none exists yet.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_org_assistant_config(p_org uuid)
RETURNS TABLE (
  enabled boolean,
  allowed_roles text[],
  custom_rules text,
  banned_topics text[],
  max_input_chars integer,
  student_safe_mode boolean,
  updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  -- Caller must belong to the org (any active role) or be a platform super admin.
  SELECT c.enabled, c.allowed_roles, c.custom_rules, c.banned_topics,
         c.max_input_chars, c.student_safe_mode, c.updated_at
  FROM public.org_assistant_config c
  WHERE c.organization_id = p_org
    AND (
      EXISTS (SELECT 1 FROM public.org_memberships m
              WHERE m.organization_id = p_org AND m.user_id = auth.uid() AND m.active = true)
      OR public._is_platform_super_admin()
    )
  UNION ALL
  -- Default row when the school hasn't configured it yet.
  SELECT true,
         ARRAY['owner','admin','editor','staff','teacher','bursar','accountant','student','parent']::text[],
         NULL, ARRAY[]::text[], 2000, true, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.org_assistant_config WHERE organization_id = p_org)
    AND (
      EXISTS (SELECT 1 FROM public.org_memberships m
              WHERE m.organization_id = p_org AND m.user_id = auth.uid() AND m.active = true)
      OR public._is_platform_super_admin()
    )
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_org_assistant_config(uuid) TO authenticated;

-- ------------------------------------------------------------
-- Write: org admins (or platform super admin) only.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_org_assistant_config(
  p_org uuid,
  p_enabled boolean,
  p_allowed_roles text[],
  p_custom_rules text,
  p_banned_topics text[],
  p_max_input_chars integer,
  p_student_safe_mode boolean
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT (public._is_org_admin_for(p_org) OR public._is_platform_super_admin()) THEN
    RAISE EXCEPTION 'Not authorized to configure the assistant for this school';
  END IF;

  INSERT INTO public.org_assistant_config AS c (
    organization_id, enabled, allowed_roles, custom_rules, banned_topics,
    max_input_chars, student_safe_mode, updated_by, updated_at
  )
  VALUES (
    p_org, COALESCE(p_enabled, true),
    COALESCE(p_allowed_roles, ARRAY['owner','admin','editor','staff','teacher','bursar','accountant','student','parent']::text[]),
    p_custom_rules,
    COALESCE(p_banned_topics, ARRAY[]::text[]),
    LEAST(GREATEST(COALESCE(p_max_input_chars, 2000), 100), 8000),
    COALESCE(p_student_safe_mode, true),
    auth.uid(), now()
  )
  ON CONFLICT (organization_id) DO UPDATE
    SET enabled = EXCLUDED.enabled,
        allowed_roles = EXCLUDED.allowed_roles,
        custom_rules = EXCLUDED.custom_rules,
        banned_topics = EXCLUDED.banned_topics,
        max_input_chars = EXCLUDED.max_input_chars,
        student_safe_mode = EXCLUDED.student_safe_mode,
        updated_by = auth.uid(),
        updated_at = now();

  RETURN jsonb_build_object('ok', true);
END $$;
GRANT EXECUTE ON FUNCTION public.set_org_assistant_config(uuid, boolean, text[], text, text[], integer, boolean) TO authenticated;

-- ------------------------------------------------------------
-- Verification
-- ------------------------------------------------------------
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'org_assistant_config' ORDER BY ordinal_position;

SELECT proname FROM pg_proc
WHERE proname IN ('get_org_assistant_config', 'set_org_assistant_config')
ORDER BY proname;
