-- ============================================================
-- Push notifications: device token registry + send targeting
--
-- Adds the ONLY backend surface the mobile app needs for push:
--   1. push_device_tokens  — one row per physical device install
--   2. register_push_token() / revoke_push_token()  — caller-scoped
--   3. push_targets_for_message() / mark_push_tokens_invalid()
--      — service-role only, used by the server-side sender
--
-- SECURITY DESIGN NOTES
--
-- Tenant scoping:
--   organization_id is NEVER accepted from the client. register_push_token()
--   resolves it with current_user_org_id(), the same as every other module.
--
-- Token ownership / device reassignment:
--   expo_push_token is UNIQUE. A physical device produces one token, and if a
--   DIFFERENT user signs in on that device the token must move to them —
--   otherwise the previous user keeps receiving the new user's notifications.
--   ON CONFLICT (expo_push_token) DO UPDATE reassigns user_id AND
--   organization_id and clears revoked_at. This is the security-critical part
--   of this migration: a stale mapping leaks message previews across accounts.
--
-- RLS:
--   Owner-only. A user may see and revoke their own device rows and nothing
--   else. Staff and admins get NO read path — a device token is a delivery
--   address, not school data, and nothing in the product needs to list them.
--   The sender runs as service_role, which bypasses RLS by design.
--
-- Service-role-only functions:
--   push_targets_for_message() returns delivery addresses for OTHER people.
--   It is SECURITY DEFINER and EXECUTE is granted to service_role ONLY —
--   never to authenticated — so a signed-in client cannot enumerate tokens.
--   REVOKE ... FROM PUBLIC is explicit because Postgres grants EXECUTE to
--   PUBLIC by default on new functions.
--
-- Mute is honoured at the source:
--   A member who muted a conversation, or set notification_pref='muted', is
--   excluded from targeting. The sender never learns their token.
--
-- Idempotent. Safe to re-run.
-- DO NOT apply to Production without explicit authorization.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.push_device_tokens (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expo_push_token  text NOT NULL,
  platform         text NOT NULL DEFAULT 'unknown',
  device_name      text,
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at       timestamptz,
  CONSTRAINT push_device_tokens_token_unique UNIQUE (expo_push_token),
  CONSTRAINT push_device_tokens_platform_chk CHECK (platform IN ('ios', 'android', 'web', 'unknown'))
);

-- Sender lookup path: active tokens for a set of users.
CREATE INDEX IF NOT EXISTS push_device_tokens_user_active_idx
  ON public.push_device_tokens (user_id)
  WHERE revoked_at IS NULL;

-- Tenant reporting / cleanup path.
CREATE INDEX IF NOT EXISTS push_device_tokens_org_idx
  ON public.push_device_tokens (organization_id);

-- ------------------------------------------------------------
-- 2. RLS — owner only
-- ------------------------------------------------------------
ALTER TABLE public.push_device_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_tokens_self_read   ON public.push_device_tokens;
DROP POLICY IF EXISTS push_tokens_self_update ON public.push_device_tokens;
DROP POLICY IF EXISTS push_tokens_self_delete ON public.push_device_tokens;

CREATE POLICY push_tokens_self_read ON public.push_device_tokens
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY push_tokens_self_update ON public.push_device_tokens
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY push_tokens_self_delete ON public.push_device_tokens
  FOR DELETE USING (user_id = auth.uid());

-- Deliberately NO insert policy: registration goes through
-- register_push_token() so organization_id is always server-resolved.

-- ------------------------------------------------------------
-- 3. register_push_token — caller-scoped upsert
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_push_token(
  p_token       text,
  p_platform    text DEFAULT 'unknown',
  p_device_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_org  uuid;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_token');
  END IF;

  -- Organisation is resolved server-side. Never accepted from the client.
  v_org := current_user_org_id();
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_organization');
  END IF;

  INSERT INTO public.push_device_tokens
    (organization_id, user_id, expo_push_token, platform, device_name, last_seen_at, revoked_at)
  VALUES
    (v_org, v_user, btrim(p_token),
     COALESCE(NULLIF(p_platform, ''), 'unknown'),
     NULLIF(btrim(COALESCE(p_device_name, '')), ''),
     now(), NULL)
  ON CONFLICT (expo_push_token) DO UPDATE
    SET user_id         = EXCLUDED.user_id,          -- device changed hands
        organization_id = EXCLUDED.organization_id,
        platform        = EXCLUDED.platform,
        device_name     = EXCLUDED.device_name,
        last_seen_at    = now(),
        revoked_at      = NULL;

  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.register_push_token(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_push_token(text, text, text) TO authenticated;

-- ------------------------------------------------------------
-- 4. revoke_push_token — used on sign-out
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_push_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  UPDATE public.push_device_tokens
     SET revoked_at = now()
   WHERE expo_push_token = btrim(p_token)
     AND user_id = v_user;      -- a caller may only revoke their own device

  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.revoke_push_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_push_token(text) TO authenticated;

-- ------------------------------------------------------------
-- 5. push_targets_for_message — SERVICE ROLE ONLY
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.push_targets_for_message(p_message_id uuid)
RETURNS TABLE (
  user_id         uuid,
  expo_push_token text,
  title           text,
  body            text,
  conversation_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH msg AS (
    SELECT m.id, m.conversation_id, m.sender_id, m.body, m.message_type, m.deleted_at
    FROM public.messages m
    WHERE m.id = p_message_id
  ),
  conv AS (
    SELECT c.id, c.type, c.title, c.locked_at
    FROM public.conversations c
    JOIN msg ON msg.conversation_id = c.id
  ),
  sender AS (
    SELECT COALESCE(p.full_name, 'Someone') AS full_name
    FROM msg
    LEFT JOIN public.profiles p ON p.id = msg.sender_id
  )
  SELECT
    cm.user_id,
    t.expo_push_token,
    CASE
      WHEN conv.type = 'direct' THEN (SELECT full_name FROM sender)
      ELSE COALESCE(conv.title, 'School group')
    END AS title,
    CASE
      WHEN msg.message_type = 'image'    THEN (SELECT full_name FROM sender) || ' sent a photo'
      WHEN msg.message_type = 'document' THEN (SELECT full_name FROM sender) || ' sent a document'
      WHEN msg.message_type = 'voice'    THEN (SELECT full_name FROM sender) || ' sent a voice note'
      WHEN conv.type = 'direct'          THEN LEFT(COALESCE(msg.body, ''), 140)
      ELSE (SELECT full_name FROM sender) || ': ' || LEFT(COALESCE(msg.body, ''), 120)
    END AS body,
    conv.id AS conversation_id
  FROM msg
  JOIN conv ON TRUE
  JOIN public.conversation_members cm
    ON cm.conversation_id = msg.conversation_id
  JOIN public.push_device_tokens t
    ON t.user_id = cm.user_id
   AND t.revoked_at IS NULL
  WHERE msg.deleted_at IS NULL
    AND conv.locked_at IS NULL
    AND cm.user_id <> msg.sender_id       -- never notify the sender
    AND cm.left_at IS NULL                -- former members get nothing
    AND cm.muted_at IS NULL               -- muted conversation
    AND COALESCE(cm.notification_pref, 'all') <> 'muted';
$$;

REVOKE ALL ON FUNCTION public.push_targets_for_message(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.push_targets_for_message(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.push_targets_for_message(uuid) TO service_role;

-- ------------------------------------------------------------
-- 6. mark_push_tokens_invalid — SERVICE ROLE ONLY
--    Called when Expo reports DeviceNotRegistered, so dead tokens
--    stop being retried forever.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_push_tokens_invalid(p_tokens text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.push_device_tokens
     SET revoked_at = now()
   WHERE expo_push_token = ANY (p_tokens)
     AND revoked_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.mark_push_tokens_invalid(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_push_tokens_invalid(text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mark_push_tokens_invalid(text[]) TO service_role;

-- ============================================================
-- VERIFY
-- Expect: 3 policies on push_device_tokens (SELECT/UPDATE/DELETE,
-- all user_id = auth.uid()), and NO insert policy.
-- ============================================================
SELECT policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'push_device_tokens'
ORDER BY cmd, policyname;

-- Expect exactly: register_push_token + revoke_push_token granted to
-- authenticated; push_targets_for_message + mark_push_tokens_invalid
-- granted to service_role ONLY.
SELECT p.proname,
       array_agg(DISTINCT a.rolname ORDER BY a.rolname) AS granted_to
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
LEFT JOIN LATERAL (
  SELECT r.rolname
  FROM pg_roles r
  WHERE has_function_privilege(r.oid, p.oid, 'EXECUTE')
    AND r.rolname IN ('anon', 'authenticated', 'service_role')
) a ON TRUE
WHERE n.nspname = 'public'
  AND p.proname IN ('register_push_token', 'revoke_push_token',
                    'push_targets_for_message', 'mark_push_tokens_invalid')
GROUP BY p.proname
ORDER BY p.proname;
