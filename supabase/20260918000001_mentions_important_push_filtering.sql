-- Migration: 20260918000001_mentions_important_push_filtering
--
-- Adds mentioned_user_ids (uuid[]) and is_important (boolean) columns to the
-- messages table, wires them through send_message and get_messages, and
-- updates push_targets_for_message to honour 'mentions' and 'important'
-- notification_pref values.
--
-- These columns are new; the mobile app was already sending p_mentioned_user_ids
-- and p_is_important to send_message (they were silently ignored before this
-- migration), and the mobile picker already lets users set notification_pref
-- to 'mentions' or 'important' (they were honoured only for the 'muted' check
-- in push_targets_for_message).
--
-- No RLS change required: messages are already readable only by conversation
-- members via the existing messages_member_read policy. No table is added.
--
-- Security posture unchanged: every existing SECURITY DEFINER / GRANT pattern
-- is preserved verbatim.

-- ─── 1. Add columns to messages ──────────────────────────────────────────────

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS mentioned_user_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_important boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_messages_mentioned
  ON public.messages USING GIN (mentioned_user_ids)
  WHERE array_length(mentioned_user_ids, 1) > 0;

-- ─── 2. Update send_message ───────────────────────────────────────────────────
-- Adds p_mentioned_user_ids and p_is_important. The old 5-arg signature is
-- still valid (both new params default to safe values) so existing callers
-- are unaffected.

CREATE OR REPLACE FUNCTION public.send_message(
  p_conversation_id uuid,
  p_body text DEFAULT NULL,
  p_message_type text DEFAULT 'text',
  p_reply_to_id uuid DEFAULT NULL,
  p_attachments jsonb DEFAULT NULL,
  p_mentioned_user_ids uuid[] DEFAULT '{}',
  p_is_important boolean DEFAULT false
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

  IF EXISTS (
    SELECT 1 FROM messaging_restrictions
    WHERE organization_id = v_org AND user_id = v_me AND active = true
  ) THEN
    RAISE EXCEPTION 'Your messaging access has been restricted';
  END IF;

  SELECT * INTO v_conv
  FROM conversations
  WHERE id = p_conversation_id AND organization_id = v_org;
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

  INSERT INTO messages (
    organization_id, conversation_id, sender_id, message_type, body,
    reply_to_id, mentioned_user_ids, is_important
  )
  VALUES (
    v_org, p_conversation_id, v_me, p_message_type, p_body,
    p_reply_to_id,
    COALESCE(p_mentioned_user_ids, '{}'),
    COALESCE(p_is_important, false)
  )
  RETURNING * INTO v_msg;

  IF p_attachments IS NOT NULL THEN
    FOR v_att IN SELECT * FROM jsonb_array_elements(p_attachments) LOOP
      INSERT INTO message_attachments (
        organization_id, message_id, storage_path, file_name, file_type,
        file_size_bytes, width, height
      )
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
-- Grant to match original (old overload is superseded by this one)
GRANT EXECUTE ON FUNCTION public.send_message(uuid, text, text, uuid, jsonb, uuid[], boolean) TO authenticated;

-- ─── 3. Update get_messages — add mentioned_user_ids and is_important to result ─

CREATE OR REPLACE FUNCTION public.get_messages(
  p_conversation_id uuid,
  p_before timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 40
)
RETURNS TABLE (
  id uuid, sender_id uuid, sender_name text, sender_role text,
  message_type text, body text,
  reply_to_id uuid, reply_to_body text, reply_to_sender_id uuid,
  created_at timestamptz, edited_at timestamptz, deleted_at timestamptz, pinned_at timestamptz,
  attachments jsonb, reactions jsonb,
  mentioned_user_ids uuid[], is_important boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_org uuid := current_user_org_id();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM conversation_members
    WHERE conversation_id = p_conversation_id AND user_id = auth.uid() AND left_at IS NULL
  ) THEN
    RAISE EXCEPTION 'You are not a member of this conversation';
  END IF;
  RETURN QUERY
  SELECT
    m.id, m.sender_id,
    COALESCE(sm.full_name, s.full_name, pp.full_name, p.full_name, 'Unknown') AS sender_name,
    COALESCE(om.role, 'unknown') AS sender_role,
    m.message_type,
    CASE WHEN m.deleted_at IS NOT NULL THEN NULL ELSE m.body END,
    m.reply_to_id, rm.body, rm.sender_id,
    m.created_at, m.edited_at, m.deleted_at, m.pinned_at,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'storage_path', a.storage_path, 'file_name', a.file_name,
        'file_type', a.file_type, 'file_size_bytes', a.file_size_bytes,
        'width', a.width, 'height', a.height
      )) FROM message_attachments a WHERE a.message_id = m.id
    ), '[]'::jsonb) AS attachments,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('emoji', r.emoji, 'user_id', r.user_id))
      FROM message_reactions r WHERE r.message_id = m.id
    ), '[]'::jsonb) AS reactions,
    m.mentioned_user_ids,
    m.is_important
  FROM messages m
  LEFT JOIN messages rm ON rm.id = m.reply_to_id
  LEFT JOIN org_memberships om ON om.user_id = m.sender_id AND om.organization_id = v_org
  LEFT JOIN staff_members sm ON sm.user_id = m.sender_id AND sm.organization_id = v_org
  LEFT JOIN students s ON s.profile_id = m.sender_id AND s.organization_id = v_org
  LEFT JOIN parent_profiles pp ON pp.profile_id = m.sender_id AND pp.organization_id = v_org
  LEFT JOIN profiles p ON p.id = m.sender_id
  WHERE m.conversation_id = p_conversation_id AND m.organization_id = v_org
    AND (p_before IS NULL OR m.created_at < p_before)
  ORDER BY m.created_at DESC
  LIMIT p_limit;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_messages(uuid, timestamptz, integer) TO authenticated;

-- ─── 4. Update push_targets_for_message — honour mentions and important ────────
-- Logic:
--   'all'       → always notified (as before)
--   'muted'     → never notified (as before, via muted_at AND pref check)
--   'mentions'  → notified only if auth.uid() is in msg.mentioned_user_ids
--   'important' → notified only if msg.is_important = true
-- Sender is always excluded. Former members (left_at IS NOT NULL) excluded.
-- Locked/deleted messages excluded.

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
    SELECT m.id, m.conversation_id, m.sender_id, m.body, m.message_type,
           m.deleted_at, m.mentioned_user_ids, m.is_important
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
    AND cm.user_id <> msg.sender_id        -- never notify the sender
    AND cm.left_at IS NULL                 -- former members get nothing
    AND cm.muted_at IS NULL                -- muted conversation
    AND COALESCE(cm.notification_pref, 'all') <> 'muted'
    -- mentions: member set pref to 'mentions' → only notify if they are mentioned
    AND (
      COALESCE(cm.notification_pref, 'all') <> 'mentions'
      OR cm.user_id = ANY(msg.mentioned_user_ids)
    )
    -- important: member set pref to 'important' → only notify if message is marked important
    AND (
      COALESCE(cm.notification_pref, 'all') <> 'important'
      OR msg.is_important = true
    );
$$;

REVOKE ALL ON FUNCTION public.push_targets_for_message(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.push_targets_for_message(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.push_targets_for_message(uuid) TO service_role;
