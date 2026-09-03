-- =====================================================================
-- MESSAGING + MY-PROFILE FIXES
-- =====================================================================
-- Fixes two live bugs and adds one RPC to support a role-agnostic My
-- Profile page + student self-service photo uploads:
--
--   1. list_conversations() had bare "conversation_id" references in
--      three subqueries that are ambiguous against the function's own
--      OUT parameter of the same name (RETURNS TABLE (conversation_id
--      uuid, ...)) -- this is the exact cause of:
--        - "column reference conversation_id is ambiguous" when
--          broadcasting a message to the in-app inbox
--        - the chat not opening after starting a new conversation /
--          not refreshing live (the RPC silently errors every time it's
--          called, so the sidebar's conversation list never updates)
--      Fixed by fully qualifying every reference to the CTE's own
--      column (my_convs.conversation_id) instead of the bare name.
--      (Identical fix to the already-drafted, never-applied
--      supabase/fix_list_conversations_ambiguous_columns.sql -- this
--      file supersedes it; both are safe to run, this one also adds
--      the profile/photo pieces below.)
--
--   2. get_my_profile(): a single role-agnostic RPC so the My Profile
--      page works for staff, students and parents alike, not just
--      staff (previously hardcoded to look up staff_members by email
--      only). Mirrors the same COALESCE(staff, student, parent,
--      profile) pattern already used by list_conversations/get_messages.
--
--   3. submit_student_photo_self(): lets a student who has their own
--      login upload their own photo, following the same moderation
--      safeguard as a parent-submitted photo (queued for admin/staff
--      approval, never written to students.photo_url directly) --
--      submit_student_photo() only worked for a linked parent.
--
-- SAFE TO RE-RUN.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Fix: list_conversations() ambiguous column references
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_conversations(p_limit integer DEFAULT 50)
RETURNS TABLE (
  conversation_id uuid, type text, title text, description text, avatar_url text, context jsonb,
  is_auto boolean, archived_at timestamptz, locked_at timestamptz, updated_at timestamptz,
  member_role text, muted_at timestamptz, pinned_at timestamptz, last_read_at timestamptz, notification_pref text,
  other_user_id uuid, other_full_name text, other_role text,
  last_message_body text, last_message_type text, last_message_at timestamptz, last_message_sender_id uuid,
  unread_count integer, member_count integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_org uuid := current_user_org_id(); v_me uuid := auth.uid();
BEGIN
  RETURN QUERY
  WITH my_convs AS (
    SELECT cm.conversation_id, cm.member_role, cm.muted_at, cm.pinned_at, cm.last_read_at, cm.notification_pref
    FROM conversation_members cm
    WHERE cm.user_id = v_me AND cm.left_at IS NULL AND cm.organization_id = v_org
  ),
  last_msg AS (
    SELECT DISTINCT ON (m.conversation_id) m.conversation_id, m.body, m.message_type, m.created_at, m.sender_id
    FROM messages m
    WHERE m.conversation_id IN (SELECT my_convs.conversation_id FROM my_convs) AND m.deleted_at IS NULL
    ORDER BY m.conversation_id, m.created_at DESC
  ),
  unread AS (
    SELECT m.conversation_id, COUNT(*) AS cnt
    FROM messages m JOIN my_convs mc ON mc.conversation_id = m.conversation_id
    WHERE m.created_at > mc.last_read_at AND m.sender_id <> v_me AND m.deleted_at IS NULL
    GROUP BY m.conversation_id
  ),
  member_counts AS (
    SELECT cm.conversation_id, COUNT(*) AS cnt FROM conversation_members cm
    WHERE cm.conversation_id IN (SELECT my_convs.conversation_id FROM my_convs) AND cm.left_at IS NULL
    GROUP BY cm.conversation_id
  ),
  other_member AS (
    SELECT DISTINCT ON (cm.conversation_id) cm.conversation_id, cm.user_id AS other_user_id
    FROM conversation_members cm
    WHERE cm.conversation_id IN (SELECT my_convs.conversation_id FROM my_convs) AND cm.user_id <> v_me AND cm.left_at IS NULL
    ORDER BY cm.conversation_id, cm.joined_at
  )
  SELECT
    c.id, c.type, c.title, c.description, c.avatar_url, c.context, c.is_auto, c.archived_at, c.locked_at, c.updated_at,
    mc.member_role, mc.muted_at, mc.pinned_at, mc.last_read_at, mc.notification_pref,
    om.other_user_id,
    COALESCE(sm.full_name, s.full_name, pp.full_name, p.full_name) AS other_full_name,
    orgm.role AS other_role,
    lm.body, lm.message_type, lm.created_at, lm.sender_id,
    COALESCE(u.cnt, 0)::integer,
    COALESCE(mcnt.cnt, 0)::integer
  FROM my_convs mc
  JOIN conversations c ON c.id = mc.conversation_id
  LEFT JOIN last_msg lm ON lm.conversation_id = c.id
  LEFT JOIN unread u ON u.conversation_id = c.id
  LEFT JOIN member_counts mcnt ON mcnt.conversation_id = c.id
  LEFT JOIN other_member om ON om.conversation_id = c.id
  LEFT JOIN org_memberships orgm ON orgm.user_id = om.other_user_id AND orgm.organization_id = v_org
  LEFT JOIN staff_members sm ON sm.user_id = om.other_user_id AND sm.organization_id = v_org
  LEFT JOIN students s ON s.profile_id = om.other_user_id AND s.organization_id = v_org
  LEFT JOIN parent_profiles pp ON pp.profile_id = om.other_user_id AND pp.organization_id = v_org
  LEFT JOIN profiles p ON p.id = om.other_user_id
  WHERE c.archived_at IS NULL
  ORDER BY (mc.pinned_at IS NOT NULL) DESC, COALESCE(lm.created_at, c.updated_at) DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_conversations(integer) TO authenticated;

-- ---------------------------------------------------------------------
-- 2. Role-agnostic "who am I" for the My Profile page.
-- ---------------------------------------------------------------------
-- Returns exactly one row describing the caller's own record, whichever
-- table it actually lives in. kind tells the client which upload path
-- to use: 'staff' writes staff_members.photo_url directly (self-service,
-- already trusted); 'student' must go through the moderation queue
-- (submit_student_photo_self, below) even for the student's own upload;
-- 'parent' has no single photo of their own in this schema today (their
-- photo flow is per-child, on My Children) so kind='parent' just
-- confirms identity for a friendly message rather than a broken lookup.
CREATE OR REPLACE FUNCTION get_my_profile()
RETURNS TABLE (
  kind text,
  entity_id uuid,
  full_name text,
  subtitle text,
  photo_url text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_me uuid := auth.uid();
  v_email text;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = v_me;

  RETURN QUERY
  SELECT 'staff'::text, sm.id, sm.full_name, COALESCE(sm.job_title, sm.staff_code), sm.photo_url
  FROM staff_members sm
  WHERE sm.organization_id = v_org AND v_email IS NOT NULL AND lower(sm.email) = lower(v_email)
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT 'student'::text, s.id, s.full_name, c.name, s.photo_url
  FROM students s
  LEFT JOIN student_enrollments se ON se.student_id = s.id AND se.status = 'active'
  LEFT JOIN academic_years ay ON ay.id = se.academic_year_id AND ay.status = 'current'
  LEFT JOIN classes c ON c.id = se.class_id
  WHERE s.organization_id = v_org AND s.profile_id = v_me
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT 'parent'::text, pp.id, pp.full_name, 'Parent/Guardian'::text, NULL::text
  FROM parent_profiles pp
  WHERE pp.organization_id = v_org AND pp.profile_id = v_me
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT 'unknown'::text, NULL::uuid, COALESCE(p.full_name, v_email, 'Account'), NULL::text, NULL::text
  FROM profiles p WHERE p.id = v_me;
END;
$$;

GRANT EXECUTE ON FUNCTION get_my_profile() TO authenticated;

-- ---------------------------------------------------------------------
-- 3. A logged-in student submits their own photo (moderation-gated,
--    same as a parent submission -- never written directly).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION submit_student_photo_self(p_photo_url text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_student_id uuid;
  v_submission_id uuid;
BEGIN
  SELECT id INTO v_student_id FROM students
  WHERE organization_id = v_org AND profile_id = auth.uid()
  LIMIT 1;

  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'No student record is linked to your login.';
  END IF;

  INSERT INTO student_photo_submissions (organization_id, student_id, submitted_by_parent_id, photo_url, status)
  VALUES (v_org, v_student_id, NULL, p_photo_url, 'pending')
  RETURNING id INTO v_submission_id;

  RETURN v_submission_id;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_student_photo_self(text) TO authenticated;

-- ---------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------
SELECT
  (SELECT COUNT(*) FROM pg_proc WHERE proname = 'get_my_profile') AS get_my_profile_installed,
  (SELECT COUNT(*) FROM pg_proc WHERE proname = 'submit_student_photo_self') AS submit_student_photo_self_installed;
