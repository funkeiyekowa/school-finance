-- =====================================================================
-- BROADCAST CHANNELS MODULE
-- =====================================================================
-- Adds two things to Communication > Announcements:
--
--   1. In-app "Parent Inbox" delivery, fully working today with no
--      external account: broadcast_announcement_to_inbox() posts the
--      announcement as a message into a per-target-scope announcement
--      conversation (reuses the messaging module's own 'announcement'
--      conversation type -- see 20260902180000_communication_module.sql,
--      section 12/create_group -- which already enforces "only staff
--      admins can post, everyone else reads"). Parents/staff/students
--      see it show up in their normal Messages inbox in realtime,
--      through the same subscription every other conversation already
--      uses -- no new client-side realtime work needed.
--
--   2. notification_providers -- per-org, encrypted storage for SMS and
--      email provider credentials (API key, sender id / from-address,
--      provider choice), so a school can plug in their own Termii /
--      Africa's Talking / Twilio / generic-webhook SMS account and
--      their own Resend / SendGrid / SMTP email account. Mirrors the
--      existing org_ai_settings pattern exactly (see
--      ai_provider_settings_v2.sql + src/lib/ai/keyCrypto.ts): the
--      encryption secret lives only in the Vercel server environment,
--      Postgres only ever stores ciphertext, and the API route is the
--      only thing that can decrypt it. This migration only creates the
--      storage + config RPCs; it does NOT include actual SMS/email
--      sending code (that needs Deji's own provider account + API key
--      first) -- the app layer that will call out to a provider once
--      configured lives in src/lib/notifications/send.ts.
--
-- SAFE TO RE-RUN.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. notification_providers
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,

  -- SMS
  sms_provider text,                 -- 'termii' | 'africastalking' | 'twilio' | 'webhook' | NULL (not configured)
  sms_sender_id text,                -- the "from" name/number the provider sends as
  sms_api_key_ciphertext text,       -- AES-256-GCM, see keyCrypto.ts (reused for this module too)
  sms_extra jsonb NOT NULL DEFAULT '{}', -- provider-specific extras (e.g. Africa's Talking username, Twilio account SID, webhook URL)
  sms_configured_at timestamptz,
  sms_configured_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Email
  email_provider text,               -- 'resend' | 'sendgrid' | 'smtp' | NULL
  email_from_address text,
  email_from_name text,
  email_api_key_ciphertext text,
  email_extra jsonb NOT NULL DEFAULT '{}', -- e.g. SMTP host/port/username (password goes in the ciphertext column)
  email_configured_at timestamptz,
  email_configured_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notification_providers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_providers_read ON notification_providers;
CREATE POLICY notification_providers_read ON notification_providers FOR SELECT
  USING (organization_id = current_user_org_id() AND is_org_admin(organization_id));
-- No direct client write policy -- ciphertext columns are only ever
-- written by the service-role API route (see
-- /api/notifications/provider-settings), same pattern as org_ai_settings.

-- ---------------------------------------------------------------------
-- get_notification_provider_settings() -- admin-only read of the
-- NON-secret fields (never returns the ciphertext columns), so the
-- settings page can show "SMS: Termii, sender ID SCHOOLNAME, configured"
-- without ever exposing the key itself back to the browser.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_notification_provider_settings()
RETURNS TABLE (
  sms_provider text, sms_sender_id text, sms_configured boolean, sms_configured_at timestamptz,
  email_provider text, email_from_address text, email_from_name text,
  email_configured boolean, email_configured_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
BEGIN
  IF v_org IS NULL OR NOT is_org_admin(v_org) THEN
    RAISE EXCEPTION 'Only school administrators can view broadcast provider settings';
  END IF;

  RETURN QUERY
  SELECT
    np.sms_provider, np.sms_sender_id,
    (np.sms_api_key_ciphertext IS NOT NULL) AS sms_configured, np.sms_configured_at,
    np.email_provider, np.email_from_address, np.email_from_name,
    (np.email_api_key_ciphertext IS NOT NULL) AS email_configured, np.email_configured_at
  FROM notification_providers np
  WHERE np.organization_id = v_org;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_notification_provider_settings() TO authenticated;

-- ---------------------------------------------------------------------
-- 2. broadcast_announcement_to_inbox -- the in-app delivery channel.
--
-- p_scope: 'all' | 'staff' | 'parents' | 'students' | 'class'
-- p_class_id: required when p_scope = 'class' (parents+students of
--   that class only; matches announcements.target/target_class_id)
--
-- Reuses one persistent announcement conversation per (org, scope[,
-- class]) rather than creating a new conversation per broadcast, so
-- recipients see a running history of announcements in one thread
-- instead of a new inbox entry per message -- same UX as a school's
-- WhatsApp broadcast list or an email newsletter thread.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.broadcast_announcement_to_inbox(
  p_title text, p_body text, p_scope text DEFAULT 'all', p_class_id uuid DEFAULT NULL
)
RETURNS TABLE (conversation_id uuid, recipients_added integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_me uuid := auth.uid();
  v_key text;
  v_title text;
  v_conv_id uuid;
  v_added integer := 0;
  v_member RECORD;
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'No active organization'; END IF;
  IF NOT (is_staff_user() AND is_org_admin(v_org)) THEN
    RAISE EXCEPTION 'Only school administrators can broadcast announcements';
  END IF;
  IF p_scope NOT IN ('all','staff','parents','students','class') THEN
    RAISE EXCEPTION 'Unknown broadcast scope: %', p_scope;
  END IF;
  IF p_scope = 'class' AND p_class_id IS NULL THEN
    RAISE EXCEPTION 'class_id is required when scope is class';
  END IF;

  v_key := 'announce_inbox:' || p_scope || COALESCE(':' || p_class_id::text, '');
  v_title := CASE
    WHEN p_scope = 'all' THEN 'School Announcements'
    WHEN p_scope = 'staff' THEN 'Staff Announcements'
    WHEN p_scope = 'parents' THEN 'Parent Announcements'
    WHEN p_scope = 'students' THEN 'Student Announcements'
    WHEN p_scope = 'class' THEN (SELECT c.name || ' Announcements' FROM classes c WHERE c.id = p_class_id)
  END;

  INSERT INTO conversations (organization_id, type, title, auto_key, is_auto, created_by)
  VALUES (v_org, 'announcement', COALESCE(v_title, 'Announcements'), v_key, true, v_me)
  ON CONFLICT (organization_id, auto_key) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_conv_id;

  -- Make sure the caller is an admin member so send_message()'s "only
  -- announcement admins can post" check passes.
  INSERT INTO conversation_members (conversation_id, organization_id, user_id, member_role)
  VALUES (v_conv_id, v_org, v_me, 'admin')
  ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL, member_role = 'admin';

  -- Add every other admin too, so any admin can post follow-ups here.
  FOR v_member IN
    SELECT DISTINCT om.user_id AS uid FROM org_memberships om
    WHERE om.organization_id = v_org AND om.active = true
      AND om.role IN ('owner','admin') AND om.user_id <> v_me
  LOOP
    INSERT INTO conversation_members (conversation_id, organization_id, user_id, member_role)
    VALUES (v_conv_id, v_org, v_member.uid, 'admin')
    ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL;
  END LOOP;

  -- Recipients, read-only members of this conversation.
  IF p_scope = 'all' THEN
    FOR v_member IN
      SELECT DISTINCT om.user_id AS uid FROM org_memberships om
      WHERE om.organization_id = v_org AND om.active = true AND om.user_id <> v_me
    LOOP
      INSERT INTO conversation_members (conversation_id, organization_id, user_id, member_role)
      VALUES (v_conv_id, v_org, v_member.uid, 'member')
      ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL;
      v_added := v_added + 1;
    END LOOP;

  ELSIF p_scope = 'staff' THEN
    FOR v_member IN
      SELECT DISTINCT om.user_id AS uid FROM org_memberships om
      WHERE om.organization_id = v_org AND om.active = true AND is_staff_role(om.role) AND om.user_id <> v_me
    LOOP
      INSERT INTO conversation_members (conversation_id, organization_id, user_id, member_role)
      VALUES (v_conv_id, v_org, v_member.uid, 'member')
      ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL;
      v_added := v_added + 1;
    END LOOP;

  ELSIF p_scope = 'parents' THEN
    FOR v_member IN
      SELECT DISTINCT pp.profile_id AS uid FROM parent_profiles pp
      WHERE pp.organization_id = v_org AND pp.profile_id IS NOT NULL
    LOOP
      INSERT INTO conversation_members (conversation_id, organization_id, user_id, member_role)
      VALUES (v_conv_id, v_org, v_member.uid, 'member')
      ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL;
      v_added := v_added + 1;
    END LOOP;

  ELSIF p_scope = 'students' THEN
    FOR v_member IN
      SELECT DISTINCT s.profile_id AS uid FROM students s
      WHERE s.organization_id = v_org AND s.status = 'active' AND s.profile_id IS NOT NULL
    LOOP
      INSERT INTO conversation_members (conversation_id, organization_id, user_id, member_role)
      VALUES (v_conv_id, v_org, v_member.uid, 'member')
      ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL;
      v_added := v_added + 1;
    END LOOP;

  ELSIF p_scope = 'class' THEN
    -- Parents of this class's active students, plus the students
    -- themselves (when they have their own login) and the class's
    -- assigned teachers.
    FOR v_member IN
      SELECT DISTINCT pp.profile_id AS uid FROM student_enrollments se
      JOIN parent_student_links psl ON psl.student_id = se.student_id
      JOIN parent_profiles pp ON pp.id = psl.parent_id
      WHERE se.class_id = p_class_id AND se.status = 'active' AND pp.profile_id IS NOT NULL AND pp.organization_id = v_org
    LOOP
      INSERT INTO conversation_members (conversation_id, organization_id, user_id, member_role)
      VALUES (v_conv_id, v_org, v_member.uid, 'member')
      ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL;
      v_added := v_added + 1;
    END LOOP;
    FOR v_member IN
      SELECT DISTINCT s.profile_id AS uid FROM students s
      JOIN student_enrollments se ON se.student_id = s.id
      WHERE se.class_id = p_class_id AND se.status = 'active' AND s.profile_id IS NOT NULL AND s.organization_id = v_org
    LOOP
      INSERT INTO conversation_members (conversation_id, organization_id, user_id, member_role)
      VALUES (v_conv_id, v_org, v_member.uid, 'member')
      ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL;
      v_added := v_added + 1;
    END LOOP;
    FOR v_member IN
      SELECT DISTINCT ta.user_id AS uid FROM teacher_assignments ta
      WHERE ta.class_id = p_class_id AND ta.active = true AND ta.organization_id = v_org AND ta.user_id <> v_me
    LOOP
      INSERT INTO conversation_members (conversation_id, organization_id, user_id, member_role)
      VALUES (v_conv_id, v_org, v_member.uid, 'admin')
      ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL;
    END LOOP;
  END IF;

  INSERT INTO messages (organization_id, conversation_id, sender_id, message_type, body)
  VALUES (v_org, v_conv_id, v_me, 'text', trim(p_title) || E'\n\n' || p_body);

  UPDATE conversations SET updated_at = now() WHERE id = v_conv_id;

  INSERT INTO messaging_audit_log (organization_id, actor_id, action, target_type, target_id, details)
  VALUES (v_org, v_me, 'announcement_broadcast', 'conversation', v_conv_id,
          jsonb_build_object('scope', p_scope, 'class_id', p_class_id, 'title', p_title, 'recipients', v_added));

  RETURN QUERY SELECT v_conv_id, v_added;
END;
$$;
GRANT EXECUTE ON FUNCTION public.broadcast_announcement_to_inbox(text, text, text, uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------
SELECT 'notification_providers' AS table_check, COUNT(*) AS n
FROM information_schema.tables WHERE table_name = 'notification_providers';

SELECT 'broadcast_announcement_to_inbox' AS function_check, COUNT(*) AS n
FROM pg_proc WHERE proname = 'broadcast_announcement_to_inbox';
