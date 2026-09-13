-- Migration: mentions + importance support for push_targets_for_message()
-- Adds two columns to messages and updates the push targeting function to honour
-- notification_pref = 'mentions' and notification_pref = 'important'.
--
-- Security posture unchanged:
--   - REVOKE ALL FROM PUBLIC / GRANT EXECUTE TO service_role preserved.
--   - Recipient set can only SHRINK relative to today (mentions/important members
--     that previously received all pushes may now receive fewer — never more).
--   - organization_id isolation is unchanged (all joins remain within the
--     existing conversation_members → push_device_tokens chain).

-- ─── 1. New columns on messages ──────────────────────────────────────────────

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS mentioned_user_ids uuid[]    NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_important        boolean   NOT NULL DEFAULT false;

-- Partial index: fast look-up of messages that mention a specific user.
-- Used by push_targets_for_message() to evaluate the 'mentions' pref.
CREATE INDEX IF NOT EXISTS idx_messages_mentioned_user_ids
  ON public.messages USING GIN (mentioned_user_ids)
  WHERE array_length(mentioned_user_ids, 1) > 0;

-- ─── 2. Updated send_message() — adds p_mentioned_user_ids + p_is_important ──
--
-- New 7-arg overload with NO defaults. The existing 5-arg overload is untouched;
-- Postgres resolves by argument count so web callers are unaffected.
-- Mobile callers must supply all 7 arguments explicitly.

CREATE OR REPLACE FUNCTION public.send_message(
  p_conversation_id    uuid,
  p_body               text,
  p_message_type       text,
  p_reply_to_id        uuid,
  p_attachments        jsonb,
  p_mentioned_user_ids uuid[],   -- NEW: @-mentioned member ids
  p_is_important       boolean    -- NEW: sender marks message important
)
RETURNS messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_me  uuid := auth.uid();
  v_conv conversations%ROWTYPE;
  v_msg  messages%ROWTYPE;
  v_att  jsonb;
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'No active organization'; END IF;
  IF EXISTS (SELECT 1 FROM messaging_restrictions WHERE organization_id = v_org AND user_id = v_me AND active = true) THEN
    RAISE EXCEPTION 'Your messaging access has been restricted';
  END IF;

  SELECT * INTO v_conv FROM conversations WHERE id = p_conversation_id AND organization_id = v_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversation not found'; END IF;
  IF v_conv.locked_at IS NOT NULL THEN RAISE EXCEPTION 'This conversation has been locked by a moderator'; END IF;
  IF v_conv.archived_at IS NOT NULL THEN RAISE EXCEPTION 'This conversation is archived'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM conversation_members
    WHERE conversation_id = p_conversation_id AND user_id = v_me AND left_at IS NULL
  ) THEN
    RAISE EXCEPTION 'You are not a member of this conversation';
  END IF;

  IF v_conv.type = 'announcement' THEN
    IF NOT EXISTS (
      SELECT 1 FROM conversation_members
      WHERE conversation_id = p_conversation_id AND user_id = v_me AND left_at IS NULL
        AND member_role IN ('owner','admin','moderator')
    ) THEN
      RAISE EXCEPTION 'Only announcement admins can post here';
    END IF;
  END IF;

  IF p_message_type NOT IN ('text','image','document','voice') THEN
    RAISE EXCEPTION 'Invalid message type';
  END IF;
  IF p_message_type = 'text' AND (p_body IS NULL OR length(trim(p_body)) = 0) THEN
    RAISE EXCEPTION 'Message body cannot be empty';
  END IF;

  -- Two new columns (mentioned_user_ids, is_important) stamped server-side.
  INSERT INTO messages (
    organization_id, conversation_id, sender_id, message_type, body, reply_to_id,
    mentioned_user_ids, is_important
  )
  VALUES (
    v_org, p_conversation_id, v_me, p_message_type, p_body, p_reply_to_id,
    COALESCE(p_mentioned_user_ids, '{}'), COALESCE(p_is_important, false)
  )
  RETURNING * INTO v_msg;

  IF p_attachments IS NOT NULL THEN
    FOR v_att IN SELECT * FROM jsonb_array_elements(p_attachments) LOOP
      INSERT INTO message_attachments (organization_id, message_id, storage_path, file_name, file_type, file_size_bytes, width, height)
      VALUES (
        v_org, v_msg.id,
        v_att->>'storage_path', v_att->>'file_name', v_att->>'file_type',
        COALESCE((v_att->>'file_size_bytes')::bigint, 0),
        NULLIF(v_att->>'width','')::integer, NULLIF(v_att->>'height','')::integer
      );
    END LOOP;
  END IF;

  UPDATE conversations SET updated_at = now() WHERE id = p_conversation_id;
  UPDATE conversation_members SET last_read_at = now()
  WHERE conversation_id = p_conversation_id AND user_id = v_me;

  RETURN v_msg;
END;
$$;

-- Old 5-arg overload still exists; grant covers the new 7-arg signature.
-- The old signature is NOT dropped — existing web callers using positional
-- args with 5 params continue to resolve to the old overload until they
-- are updated, at which point both are identical except param count.
-- Safest: keep both; Postgres resolves by argument count at call-site.
GRANT EXECUTE ON FUNCTION public.send_message(uuid, text, text, uuid, jsonb, uuid[], boolean) TO authenticated;

-- ─── 3. Updated push_targets_for_message() ───────────────────────────────────

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
    SELECT
      m.id,
      m.conversation_id,
      m.sender_id,
      m.body,
      m.message_type,
      m.deleted_at,
      m.mentioned_user_ids,
      m.is_important
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
    AND cm.user_id <> msg.sender_id          -- never notify the sender
    AND cm.left_at IS NULL                   -- former members get nothing
    AND cm.muted_at IS NULL                  -- legacy mute signal
    AND COALESCE(cm.notification_pref, 'all') <> 'muted'
    -- 'mentions': only push if this member was @-mentioned in the message
    AND (
      COALESCE(cm.notification_pref, 'all') <> 'mentions'
      OR cm.user_id = ANY(msg.mentioned_user_ids)
    )
    -- 'important': only push if the sender flagged the message as important
    AND (
      COALESCE(cm.notification_pref, 'all') <> 'important'
      OR msg.is_important = true
    );
$$;

-- Re-apply grants (CREATE OR REPLACE resets them on some Postgres versions).
REVOKE ALL ON FUNCTION public.push_targets_for_message(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.push_targets_for_message(uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.push_targets_for_message(uuid) TO service_role;
