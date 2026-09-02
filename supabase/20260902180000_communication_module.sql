-- =====================================================================
-- PREMIUM SCHOOL COMMUNICATION & CHAT SYSTEM
-- =====================================================================
-- Direct messages, groups (manual + auto-managed class/subject/
-- department/staff groups), announcement channels, safeguarding
-- policy layer, moderation, and audit logging.
--
-- Design notes (read before touching RLS):
--   * Every table carries organization_id and is scoped with
--     `organization_id = current_user_org_id()` exactly like every
--     other tenant table in this codebase (see rls_role_scoped_access.sql).
--   * Read-state is a per-member CURSOR (conversation_members.last_read_at),
--     not a per-message-per-user row — this is the scalable pattern
--     (Slack/WhatsApp-style) for schools with large groups and long
--     history, and matches the platform's "design for scale" mandate.
--     message_reads is still provided, but only used for explicit
--     "seen by" tracking on announcement-type conversations (small,
--     valuable signal for admins) — not wired for every group message.
--   * All mutation goes through SECURITY DEFINER RPCs so the permission
--     matrix (safeguarding rules, parent/child scoping, moderation) is
--     enforced server-side and cannot be bypassed by direct table
--     writes from the client. RLS on the tables is the second layer
--     (defense in depth), not the only layer.
--   * Reuses is_staff_user() and my_linked_student_ids() from
--     rls_role_scoped_access.sql, and current_user_org_id() from
--     saas_foundation.sql. Does not duplicate the user/profile system.
--
-- IDEMPOTENT. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Register the module in the platform catalogue
-- ---------------------------------------------------------------------
INSERT INTO platform_modules (key, name, description, category, is_core, sort_order)
VALUES (
  'communication', 'Communication', 'Secure messaging between staff, teachers, parents and students.',
  'communication', false, 55
)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, category = EXCLUDED.category;

-- Give every existing organization access (mirrors enable_all_modules_for_schools.sql).
-- Schools still see the SetupHero / "Configure Communication" gate until an
-- admin actually configures messaging_policy (see is_messaging_configured()).
INSERT INTO subscriptions (organization_id, module_key, status)
SELECT o.id, 'communication', 'active'
FROM organizations o
ON CONFLICT (organization_id, module_key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 1. messaging_policy — per-org safeguarding & feature configuration
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messaging_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,

  -- Student safeguarding (Section 8) — secure defaults: OFF until an admin opts in.
  students_can_message boolean NOT NULL DEFAULT false,
  students_can_message_students boolean NOT NULL DEFAULT false,
  students_can_message_teachers boolean NOT NULL DEFAULT true,
  students_can_initiate_dm boolean NOT NULL DEFAULT false,

  -- Parent messaging (Section 7)
  parents_can_message boolean NOT NULL DEFAULT true,
  parents_can_message_teachers boolean NOT NULL DEFAULT true,
  parents_can_message_staff boolean NOT NULL DEFAULT false,
  parents_require_child_link boolean NOT NULL DEFAULT true,

  -- Teacher / staff
  teachers_can_message_students boolean NOT NULL DEFAULT true,
  staff_can_message_all_staff boolean NOT NULL DEFAULT true,

  -- Groups
  group_creator_roles text[] NOT NULL DEFAULT ARRAY['owner','admin','teacher'],

  -- Attachments
  max_attachment_mb integer NOT NULL DEFAULT 15,
  allowed_attachment_types text[] NOT NULL DEFAULT ARRAY[
    'image/png','image/jpeg','image/gif','image/webp','application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain','text/csv'
  ],

  -- Moderation / safeguarding
  admins_can_audit_conversations boolean NOT NULL DEFAULT true,
  moderator_roles text[] NOT NULL DEFAULT ARRAY['owner','admin'],

  -- Notifications default for new members
  default_notification_pref text NOT NULL DEFAULT 'all'
    CHECK (default_notification_pref IN ('all','mentions','important','muted')),

  -- Gate: false until an admin has explicitly walked through setup.
  configured boolean NOT NULL DEFAULT false,
  configured_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  configured_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE messaging_policy ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS messaging_policy_read ON messaging_policy;
CREATE POLICY messaging_policy_read ON messaging_policy FOR SELECT
  USING (organization_id = current_user_org_id());
-- All writes go through configure_messaging() (SECURITY DEFINER); no direct
-- client INSERT/UPDATE/DELETE policy is granted.

-- ---------------------------------------------------------------------
-- 2. conversations
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN (
    'direct','group','class','subject','parent_group','department','announcement'
  )),
  title text,
  description text,
  avatar_url text,
  -- Structured context for auto-groups & scoped DMs, e.g.
  -- {"class_id": "...", "student_id": "...", "subject_id": "...", "department_id": "..."}
  context jsonb NOT NULL DEFAULT '{}',
  -- Deterministic dedupe key for server-managed conversations so sync
  -- routines UPSERT instead of creating duplicates on every run:
  --   direct:<sorted user_id pair>[:<student_id>]
  --   class:<class_id>            subject:<subject_id>
  --   parent_group:<class_id>     department:<department_id>
  --   staff_group:<organization_id>
  auto_key text,
  is_auto boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  archived_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Messaging disabled by a moderator (Section 9) without deleting history.
  locked_at timestamptz,
  locked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  locked_reason text,
  UNIQUE (organization_id, auto_key)
);
CREATE INDEX IF NOT EXISTS idx_conversations_org ON conversations(organization_id);
CREATE INDEX IF NOT EXISTS idx_conversations_org_updated ON conversations(organization_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_type ON conversations(organization_id, type);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
-- The conversations_member_read policy (it references conversation_members,
-- defined next) is created right after that table exists, below.
-- No direct client INSERT/UPDATE/DELETE — everything goes through RPCs so
-- the permission matrix and safeguarding policy are always enforced.

-- ---------------------------------------------------------------------
-- 3. conversation_members
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversation_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_role text NOT NULL DEFAULT 'member' CHECK (member_role IN ('owner','admin','moderator','member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  muted_at timestamptz,
  pinned_at timestamptz,
  last_read_at timestamptz NOT NULL DEFAULT '1970-01-01',
  notification_pref text NOT NULL DEFAULT 'all' CHECK (notification_pref IN ('all','mentions','important','muted')),
  -- Context for scoped memberships (e.g. which child this parent's membership
  -- in a parent-teacher DM relates to) — mirrors conversations.context.
  context jsonb NOT NULL DEFAULT '{}',
  UNIQUE (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_conv_members_user ON conversation_members(user_id) WHERE left_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_conv_members_conv ON conversation_members(conversation_id) WHERE left_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_conv_members_org ON conversation_members(organization_id);

ALTER TABLE conversation_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conv_members_read ON conversation_members;
CREATE POLICY conv_members_read ON conversation_members FOR SELECT
  USING (
    organization_id = current_user_org_id()
    AND (
      user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM conversation_members me
        WHERE me.conversation_id = conversation_members.conversation_id
          AND me.user_id = auth.uid() AND me.left_at IS NULL
      )
      OR (is_staff_user() AND is_org_admin(organization_id))
    )
  );
-- Membership writes only via RPCs (create_direct_conversation, create_group,
-- add_group_member, remove_group_member, sync_auto_group).
-- Members MAY update their own row directly for lightweight per-user prefs
-- (mute / pin / notification_pref) — no safeguarding implication.
DROP POLICY IF EXISTS conv_members_self_update ON conversation_members;
CREATE POLICY conv_members_self_update ON conversation_members FOR UPDATE
  USING (organization_id = current_user_org_id() AND user_id = auth.uid())
  WITH CHECK (organization_id = current_user_org_id() AND user_id = auth.uid());

-- Now that conversation_members exists, finalize the conversations policy.
DROP POLICY IF EXISTS conversations_member_read ON conversations;
CREATE POLICY conversations_member_read ON conversations FOR SELECT
  USING (
    organization_id = current_user_org_id()
    AND (
      EXISTS (
        SELECT 1 FROM conversation_members cm
        WHERE cm.conversation_id = conversations.id
          AND cm.user_id = auth.uid() AND cm.left_at IS NULL
      )
      OR (is_staff_user() AND is_org_admin(organization_id))
    )
  );

-- ---------------------------------------------------------------------
-- 4. messages
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_type text NOT NULL DEFAULT 'text' CHECK (message_type IN ('text','image','document','voice','system')),
  body text,
  reply_to_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  pinned_at timestamptz,
  pinned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Set by moderate_message() when a report is actioned; keeps the audit
  -- trail without a second table join for the common "is this hidden" check.
  removed_by_moderator boolean NOT NULL DEFAULT false,
  CONSTRAINT messages_body_or_attachment CHECK (
    message_type = 'system' OR body IS NOT NULL OR message_type IN ('image','document','voice')
  )
);
CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_org ON messages(organization_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to_id) WHERE reply_to_id IS NOT NULL;

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
-- The full messages_member_read policy (it references moderation_reports,
-- which is defined later in this file) is created in section 8b below,
-- once every table it depends on exists.
-- All writes via send_message / edit_message / delete_message / react / pin RPCs.

-- ---------------------------------------------------------------------
-- 5. message_attachments
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  file_type text NOT NULL,
  file_size_bytes bigint NOT NULL,
  width integer,
  height integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_msg_attachments_message ON message_attachments(message_id);

ALTER TABLE message_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS msg_attachments_read ON message_attachments;
CREATE POLICY msg_attachments_read ON message_attachments FOR SELECT
  USING (
    organization_id = current_user_org_id()
    AND EXISTS (
      SELECT 1 FROM messages m
      JOIN conversation_members cm ON cm.conversation_id = m.conversation_id
      WHERE m.id = message_attachments.message_id
        AND cm.user_id = auth.uid() AND cm.left_at IS NULL
    )
  );

-- ---------------------------------------------------------------------
-- 6. message_reactions
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_msg_reactions_message ON message_reactions(message_id);

ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS msg_reactions_read ON message_reactions;
CREATE POLICY msg_reactions_read ON message_reactions FOR SELECT
  USING (
    organization_id = current_user_org_id()
    AND EXISTS (
      SELECT 1 FROM conversation_members cm
      WHERE cm.conversation_id = (SELECT conversation_id FROM messages WHERE id = message_reactions.message_id)
        AND cm.user_id = auth.uid() AND cm.left_at IS NULL
    )
  );
-- Reactions are written via react_to_message() RPC only (keeps toggle logic
-- and org_id stamping server-side).

-- ---------------------------------------------------------------------
-- 7. message_reads — "seen by" tracking, announcement conversations only
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_msg_reads_message ON message_reads(message_id);

ALTER TABLE message_reads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS msg_reads_read ON message_reads;
CREATE POLICY msg_reads_read ON message_reads FOR SELECT
  USING (
    organization_id = current_user_org_id()
    AND EXISTS (
      SELECT 1 FROM conversation_members cm
      WHERE cm.conversation_id = (SELECT conversation_id FROM messages WHERE id = message_reads.message_id)
        AND cm.user_id = auth.uid() AND cm.left_at IS NULL
    )
  );

-- ---------------------------------------------------------------------
-- 8. Moderation & safeguarding
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS moderation_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  reported_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text NOT NULL,
  details text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','actioned','dismissed')),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mod_reports_org_status ON moderation_reports(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_mod_reports_conv ON moderation_reports(conversation_id);

ALTER TABLE moderation_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mod_reports_access ON moderation_reports;
CREATE POLICY mod_reports_access ON moderation_reports FOR SELECT
  USING (
    organization_id = current_user_org_id()
    AND (reported_by = auth.uid() OR (is_staff_user() AND is_org_admin(organization_id)))
  );
-- Writes via report_message() / moderate_message() RPCs only.

CREATE TABLE IF NOT EXISTS messaging_restrictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  restricted_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text,
  restricted_at timestamptz NOT NULL DEFAULT now(),
  lifted_at timestamptz,
  lifted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_msg_restrictions_active ON messaging_restrictions(organization_id, user_id) WHERE active;

ALTER TABLE messaging_restrictions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS msg_restrictions_admin_read ON messaging_restrictions;
CREATE POLICY msg_restrictions_admin_read ON messaging_restrictions FOR SELECT
  USING (organization_id = current_user_org_id() AND is_staff_user() AND is_org_admin(organization_id));

CREATE TABLE IF NOT EXISTS messaging_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text,
  target_id uuid,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_msg_audit_org ON messaging_audit_log(organization_id, created_at DESC);

ALTER TABLE messaging_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS msg_audit_admin_read ON messaging_audit_log;
CREATE POLICY msg_audit_admin_read ON messaging_audit_log FOR SELECT
  USING (organization_id = current_user_org_id() AND is_staff_user() AND is_org_admin(organization_id));

-- ---------------------------------------------------------------------
-- 8b. Finalize the messages read policy now that moderation_reports exists.
--     Ordinary admins get NO extra visibility into private conversations —
--     only into conversations that have an open/reviewing report against
--     them (Section 9's explicit constraint).
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS messages_member_read ON messages;
CREATE POLICY messages_member_read ON messages FOR SELECT
  USING (
    organization_id = current_user_org_id()
    AND (
      EXISTS (
        SELECT 1 FROM conversation_members cm
        WHERE cm.conversation_id = messages.conversation_id
          AND cm.user_id = auth.uid() AND cm.left_at IS NULL
      )
      OR (
        is_staff_user() AND is_org_admin(organization_id)
        AND EXISTS (
          SELECT 1 FROM moderation_reports mr
          WHERE mr.conversation_id = messages.conversation_id
            AND mr.status IN ('open','reviewing')
        )
      )
    )
  );

-- Give every existing org a default (unconfigured, secure-by-default) policy
-- row so RPCs never have to branch on "row missing".
INSERT INTO messaging_policy (organization_id)
SELECT id FROM organizations
ON CONFLICT (organization_id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 9. Core helpers
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_messaging_configured()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT configured FROM messaging_policy WHERE organization_id = current_user_org_id()),
    false
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_messaging_configured() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_user_org_role(p_user uuid, p_org uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT role FROM org_memberships WHERE user_id = p_user AND organization_id = p_org AND active = true LIMIT 1),
    (SELECT role FROM profiles WHERE id = p_user AND COALESCE(active, true) = true LIMIT 1)
  );
$$;
GRANT EXECUTE ON FUNCTION public.get_user_org_role(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_staff_role(p_role text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT p_role IN ('owner','admin','editor','staff','bursar','accountant','developer','teacher','super_admin');
$$;

-- The permission matrix (Sections 4, 7, 8). Returns whether auth.uid() and
-- p_other are allowed to communicate at all, given the org's messaging_policy
-- and (for parent<->teacher) whether they share an actual child relationship.
CREATE OR REPLACE FUNCTION public.can_message_user(p_other uuid, p_context_student_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_me uuid := auth.uid();
  v_role_me text;
  v_role_other text;
  v_policy messaging_policy%ROWTYPE;
BEGIN
  IF v_org IS NULL OR p_other IS NULL OR p_other = v_me THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM messaging_restrictions
    WHERE organization_id = v_org AND active = true AND user_id IN (v_me, p_other)
  ) THEN
    RETURN false;
  END IF;

  SELECT * INTO v_policy FROM messaging_policy WHERE organization_id = v_org;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_role_me := get_user_org_role(v_me, v_org);
  v_role_other := get_user_org_role(p_other, v_org);
  IF v_role_me IS NULL OR v_role_other IS NULL THEN
    RETURN false;
  END IF;

  -- Staff-side (includes teachers) initiating/receiving.
  IF is_staff_role(v_role_me) THEN
    IF is_staff_role(v_role_other) THEN
      RETURN v_policy.staff_can_message_all_staff;
    ELSIF v_role_other = 'parent' THEN
      IF NOT v_policy.parents_can_message THEN RETURN false; END IF;
      IF v_role_me = 'teacher' THEN
        IF NOT v_policy.parents_can_message_teachers THEN RETURN false; END IF;
        IF v_policy.parents_require_child_link THEN
          RETURN EXISTS (
            SELECT 1 FROM parent_profiles pp
            JOIN parent_student_links psl ON psl.parent_id = pp.id
            JOIN student_enrollments se ON se.student_id = psl.student_id AND se.status = 'active'
            JOIN teacher_assignments ta ON ta.class_id = se.class_id AND ta.active = true
            WHERE pp.profile_id = p_other AND ta.user_id = v_me
              AND (p_context_student_id IS NULL OR psl.student_id = p_context_student_id)
          );
        END IF;
        RETURN true;
      ELSE
        RETURN v_policy.parents_can_message_staff;
      END IF;
    ELSIF v_role_other = 'student' THEN
      IF v_role_me = 'teacher' THEN
        RETURN v_policy.teachers_can_message_students;
      END IF;
      RETURN false;
    ELSE
      RETURN false;
    END IF;
  END IF;

  -- Parent initiating/receiving.
  IF v_role_me = 'parent' THEN
    IF NOT v_policy.parents_can_message THEN RETURN false; END IF;
    IF v_role_other = 'teacher' THEN
      IF NOT v_policy.parents_can_message_teachers THEN RETURN false; END IF;
      IF v_policy.parents_require_child_link THEN
        RETURN EXISTS (
          SELECT 1 FROM parent_profiles pp
          JOIN parent_student_links psl ON psl.parent_id = pp.id
          JOIN student_enrollments se ON se.student_id = psl.student_id AND se.status = 'active'
          JOIN teacher_assignments ta ON ta.class_id = se.class_id AND ta.active = true
          WHERE pp.profile_id = v_me AND ta.user_id = p_other
            AND (p_context_student_id IS NULL OR psl.student_id = p_context_student_id)
        );
      END IF;
      RETURN true;
    ELSIF is_staff_role(v_role_other) THEN
      RETURN v_policy.parents_can_message_staff;
    ELSE
      RETURN false;
    END IF;
  END IF;

  -- Student initiating/receiving.
  IF v_role_me = 'student' THEN
    IF NOT v_policy.students_can_message THEN RETURN false; END IF;
    IF v_role_other = 'student' THEN
      RETURN v_policy.students_can_message_students;
    ELSIF v_role_other = 'teacher' THEN
      RETURN v_policy.students_can_message_teachers;
    ELSE
      RETURN false;
    END IF;
  END IF;

  RETURN false;
END;
$$;
GRANT EXECUTE ON FUNCTION public.can_message_user(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 10. search_messageable_users — Section 4/12: only people the caller
--     is actually authorized to contact, never the full org directory.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_messageable_users(p_query text DEFAULT '', p_limit integer DEFAULT 25)
RETURNS TABLE(user_id uuid, full_name text, role text, subtitle text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
BEGIN
  IF v_org IS NULL THEN RETURN; END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT om.user_id AS uid, COALESCE(sm.full_name, p.full_name, 'Staff member') AS name, om.role AS role,
           COALESCE(sm.job_title, d.name, initcap(om.role)) AS subtitle
    FROM org_memberships om
    LEFT JOIN staff_members sm ON sm.user_id = om.user_id AND sm.organization_id = v_org
    LEFT JOIN departments d ON d.id = sm.department_id
    LEFT JOIN profiles p ON p.id = om.user_id
    WHERE om.organization_id = v_org AND om.active = true
      AND om.role IN ('owner','admin','editor','staff','bursar','accountant','developer','teacher')

    UNION ALL

    SELECT s.profile_id AS uid, s.full_name AS name, 'student' AS role,
           COALESCE(c.name, 'Student') AS subtitle
    FROM students s
    LEFT JOIN student_enrollments se ON se.student_id = s.id AND se.status = 'active'
    LEFT JOIN classes c ON c.id = se.class_id
    WHERE s.organization_id = v_org AND s.profile_id IS NOT NULL AND s.status = 'active'

    UNION ALL

    SELECT pp.profile_id AS uid, pp.full_name AS name, 'parent' AS role, 'Parent' AS subtitle
    FROM parent_profiles pp
    WHERE pp.organization_id = v_org AND pp.profile_id IS NOT NULL AND pp.active = true
  )
  SELECT c.uid, c.name, c.role, c.subtitle
  FROM candidates c
  WHERE c.uid IS NOT NULL
    AND c.uid <> auth.uid()
    AND (p_query = '' OR c.name ILIKE '%' || p_query || '%')
    AND can_message_user(c.uid)
  ORDER BY c.name
  LIMIT p_limit;
END;
$$;
GRANT EXECUTE ON FUNCTION public.search_messageable_users(text, integer) TO authenticated;

-- ---------------------------------------------------------------------
-- 11. create_direct_conversation — Section 4/7
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_direct_conversation(p_other uuid, p_context_student_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_me uuid := auth.uid();
  v_role_me text;
  v_policy messaging_policy%ROWTYPE;
  v_key text;
  v_conv_id uuid;
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'No active organization'; END IF;
  IF NOT can_message_user(p_other, p_context_student_id) THEN
    RAISE EXCEPTION 'You are not permitted to message this person';
  END IF;

  v_role_me := get_user_org_role(v_me, v_org);
  SELECT * INTO v_policy FROM messaging_policy WHERE organization_id = v_org;
  IF v_role_me = 'student' AND NOT v_policy.students_can_initiate_dm THEN
    RAISE EXCEPTION 'Students cannot start new conversations at this school';
  END IF;

  v_key := 'direct:' || LEAST(v_me, p_other)::text || ':' || GREATEST(v_me, p_other)::text
           || COALESCE(':' || p_context_student_id::text, '');

  INSERT INTO conversations (organization_id, type, auto_key, is_auto, created_by, context)
  VALUES (v_org, 'direct', v_key, false, v_me,
          CASE WHEN p_context_student_id IS NOT NULL
               THEN jsonb_build_object('student_id', p_context_student_id) ELSE '{}' END)
  ON CONFLICT (organization_id, auto_key) DO NOTHING
  RETURNING id INTO v_conv_id;

  IF v_conv_id IS NULL THEN
    SELECT id INTO v_conv_id FROM conversations WHERE organization_id = v_org AND auto_key = v_key;
  END IF;

  INSERT INTO conversation_members (conversation_id, organization_id, user_id, member_role, notification_pref)
  VALUES (v_conv_id, v_org, v_me, 'member', v_policy.default_notification_pref)
  ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL;

  INSERT INTO conversation_members (conversation_id, organization_id, user_id, member_role, notification_pref)
  VALUES (v_conv_id, v_org, p_other, 'member', v_policy.default_notification_pref)
  ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL;

  RETURN v_conv_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_direct_conversation(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 12. create_group — Section 5 (manual groups) & Section 16 (announcements)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_group(
  p_title text, p_description text DEFAULT NULL, p_member_ids uuid[] DEFAULT '{}',
  p_type text DEFAULT 'group', p_avatar_url text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_me uuid := auth.uid();
  v_role_me text;
  v_policy messaging_policy%ROWTYPE;
  v_conv_id uuid;
  v_member uuid;
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'No active organization'; END IF;
  IF p_title IS NULL OR length(trim(p_title)) = 0 THEN
    RAISE EXCEPTION 'A group needs a name';
  END IF;
  IF p_type NOT IN ('group','announcement') THEN
    RAISE EXCEPTION 'Auto-managed group types cannot be created manually';
  END IF;

  v_role_me := get_user_org_role(v_me, v_org);
  SELECT * INTO v_policy FROM messaging_policy WHERE organization_id = v_org;

  IF p_type = 'announcement' THEN
    IF NOT (is_staff_user() AND is_org_admin(v_org)) THEN
      RAISE EXCEPTION 'Only school administrators can create announcement channels';
    END IF;
  ELSIF NOT (v_role_me = ANY(v_policy.group_creator_roles) OR is_org_admin(v_org)) THEN
    RAISE EXCEPTION 'You do not have permission to create groups';
  END IF;

  INSERT INTO conversations (organization_id, type, title, description, avatar_url, created_by)
  VALUES (v_org, p_type, trim(p_title), p_description, p_avatar_url, v_me)
  RETURNING id INTO v_conv_id;

  INSERT INTO conversation_members (conversation_id, organization_id, user_id, member_role, notification_pref)
  VALUES (v_conv_id, v_org, v_me, 'owner', v_policy.default_notification_pref);

  FOREACH v_member IN ARRAY COALESCE(p_member_ids, '{}') LOOP
    IF v_member <> v_me THEN
      INSERT INTO conversation_members (conversation_id, organization_id, user_id, member_role, notification_pref)
      VALUES (v_conv_id, v_org, v_member, 'member', v_policy.default_notification_pref)
      ON CONFLICT (conversation_id, user_id) DO NOTHING;
    END IF;
  END LOOP;

  INSERT INTO messaging_audit_log (organization_id, actor_id, action, target_type, target_id, details)
  VALUES (v_org, v_me, 'group_created', 'conversation', v_conv_id, jsonb_build_object('type', p_type, 'title', p_title));

  RETURN v_conv_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_group(text, text, uuid[], text, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 13. sync_auto_group — Section 6: server-managed class/subject/
--     parent/department/staff groups. Idempotent (safe to call on every
--     visit to the relevant list — the UNIQUE(organization_id, auto_key)
--     means membership is *synced*, not duplicated).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_auto_group(
  p_kind text, p_class_id uuid DEFAULT NULL, p_subject_id uuid DEFAULT NULL, p_department_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_me uuid := auth.uid();
  v_key text;
  v_title text;
  v_conv_type text;
  v_conv_id uuid;
  v_member RECORD;
  v_current_ids uuid[];
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'No active organization'; END IF;
  IF NOT is_staff_user() THEN RAISE EXCEPTION 'Only staff can view school communication groups'; END IF;

  IF p_kind = 'class_staff' THEN
    IF p_class_id IS NULL THEN RAISE EXCEPTION 'class_id required'; END IF;
    v_key := 'class:' || p_class_id::text;
    v_conv_type := 'class';
    SELECT 'Teachers — ' || c.name INTO v_title FROM classes c WHERE c.id = p_class_id;
  ELSIF p_kind = 'parent_group' THEN
    IF p_class_id IS NULL THEN RAISE EXCEPTION 'class_id required'; END IF;
    v_key := 'parent_group:' || p_class_id::text;
    v_conv_type := 'parent_group';
    SELECT c.name || ' Parents' INTO v_title FROM classes c WHERE c.id = p_class_id;
  ELSIF p_kind = 'subject' THEN
    IF p_class_id IS NULL OR p_subject_id IS NULL THEN RAISE EXCEPTION 'class_id and subject_id required'; END IF;
    v_key := 'subject:' || p_class_id::text || ':' || p_subject_id::text;
    v_conv_type := 'subject';
    SELECT c.name || ' ' || s.name INTO v_title FROM classes c, subjects s WHERE c.id = p_class_id AND s.id = p_subject_id;
  ELSIF p_kind = 'department' THEN
    IF p_department_id IS NULL THEN RAISE EXCEPTION 'department_id required'; END IF;
    v_key := 'department:' || p_department_id::text;
    v_conv_type := 'department';
    SELECT name INTO v_title FROM departments WHERE id = p_department_id;
  ELSIF p_kind = 'staff' THEN
    v_key := 'staff_group:' || v_org::text;
    v_conv_type := 'department';
    SELECT 'Staff — ' || o.name INTO v_title FROM organizations o WHERE o.id = v_org;
  ELSE
    RAISE EXCEPTION 'Unknown auto-group kind: %', p_kind;
  END IF;

  INSERT INTO conversations (organization_id, type, title, auto_key, is_auto, created_by, context)
  VALUES (v_org, v_conv_type, COALESCE(v_title, initcap(p_kind)), v_key, true, v_me,
          jsonb_strip_nulls(jsonb_build_object('class_id', p_class_id, 'subject_id', p_subject_id, 'department_id', p_department_id)))
  ON CONFLICT (organization_id, auto_key) DO UPDATE SET title = EXCLUDED.title, updated_at = now()
  RETURNING id INTO v_conv_id;

  -- Compute the current member set for this kind and sync membership
  -- (add newcomers, soft-remove people no longer in scope).
  IF p_kind = 'class_staff' THEN
    FOR v_member IN
      SELECT DISTINCT ta.user_id AS uid FROM teacher_assignments ta
      WHERE ta.class_id = p_class_id AND ta.active = true AND ta.organization_id = v_org
    LOOP
      INSERT INTO conversation_members (conversation_id, organization_id, user_id, member_role)
      VALUES (v_conv_id, v_org, v_member.uid, 'member')
      ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL;
    END LOOP;
    SELECT array_agg(DISTINCT ta.user_id) INTO v_current_ids FROM teacher_assignments ta
      WHERE ta.class_id = p_class_id AND ta.active = true AND ta.organization_id = v_org;

  ELSIF p_kind = 'parent_group' THEN
    FOR v_member IN
      SELECT DISTINCT pp.profile_id AS uid FROM student_enrollments se
      JOIN parent_student_links psl ON psl.student_id = se.student_id
      JOIN parent_profiles pp ON pp.id = psl.parent_id
      WHERE se.class_id = p_class_id AND se.status = 'active' AND pp.profile_id IS NOT NULL AND pp.organization_id = v_org
    LOOP
      INSERT INTO conversation_members (conversation_id, organization_id, user_id, member_role)
      VALUES (v_conv_id, v_org, v_member.uid, 'member')
      ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL;
    END LOOP;
    FOR v_member IN
      SELECT DISTINCT ta.user_id AS uid FROM teacher_assignments ta
      WHERE ta.class_id = p_class_id AND ta.active = true AND ta.organization_id = v_org
    LOOP
      INSERT INTO conversation_members (conversation_id, organization_id, user_id, member_role)
      VALUES (v_conv_id, v_org, v_member.uid, 'admin')
      ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL;
    END LOOP;
    SELECT array_agg(DISTINCT pp.profile_id) INTO v_current_ids FROM student_enrollments se
      JOIN parent_student_links psl ON psl.student_id = se.student_id
      JOIN parent_profiles pp ON pp.id = psl.parent_id
      WHERE se.class_id = p_class_id AND se.status = 'active' AND pp.profile_id IS NOT NULL AND pp.organization_id = v_org;
    v_current_ids := v_current_ids || (SELECT array_agg(DISTINCT ta.user_id) FROM teacher_assignments ta
      WHERE ta.class_id = p_class_id AND ta.active = true AND ta.organization_id = v_org);

  ELSIF p_kind = 'subject' THEN
    FOR v_member IN
      SELECT DISTINCT ta.user_id AS uid FROM teacher_assignments ta
      WHERE ta.class_id = p_class_id AND ta.subject_id = p_subject_id AND ta.active = true AND ta.organization_id = v_org
    LOOP
      INSERT INTO conversation_members (conversation_id, organization_id, user_id, member_role)
      VALUES (v_conv_id, v_org, v_member.uid, 'member')
      ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL;
    END LOOP;
    SELECT array_agg(DISTINCT ta.user_id) INTO v_current_ids FROM teacher_assignments ta
      WHERE ta.class_id = p_class_id AND ta.subject_id = p_subject_id AND ta.active = true AND ta.organization_id = v_org;

  ELSIF p_kind = 'department' THEN
    FOR v_member IN
      SELECT DISTINCT sm.user_id AS uid FROM staff_members sm
      WHERE sm.department_id = p_department_id AND sm.status = 'active' AND sm.user_id IS NOT NULL AND sm.organization_id = v_org
    LOOP
      INSERT INTO conversation_members (conversation_id, organization_id, user_id, member_role)
      VALUES (v_conv_id, v_org, v_member.uid, 'member')
      ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL;
    END LOOP;
    SELECT array_agg(DISTINCT sm.user_id) INTO v_current_ids FROM staff_members sm
      WHERE sm.department_id = p_department_id AND sm.status = 'active' AND sm.user_id IS NOT NULL AND sm.organization_id = v_org;

  ELSIF p_kind = 'staff' THEN
    FOR v_member IN
      SELECT DISTINCT om.user_id AS uid FROM org_memberships om
      WHERE om.organization_id = v_org AND om.active = true AND is_staff_role(om.role)
    LOOP
      INSERT INTO conversation_members (conversation_id, organization_id, user_id, member_role)
      VALUES (v_conv_id, v_org, v_member.uid, 'member')
      ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL;
    END LOOP;
    SELECT array_agg(DISTINCT om.user_id) INTO v_current_ids FROM org_memberships om
      WHERE om.organization_id = v_org AND om.active = true AND is_staff_role(om.role);
  END IF;

  -- Soft-remove members who are no longer in scope (keeps history intact).
  UPDATE conversation_members
  SET left_at = now()
  WHERE conversation_id = v_conv_id AND left_at IS NULL
    AND member_role <> 'owner'
    AND NOT (user_id = ANY(COALESCE(v_current_ids, ARRAY[]::uuid[])));

  RETURN v_conv_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.sync_auto_group(text, uuid, uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 14. Group membership management (Section 15)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_group_member(p_conversation_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_me_role text;
  v_conv conversations%ROWTYPE;
BEGIN
  SELECT * INTO v_conv FROM conversations WHERE id = p_conversation_id AND organization_id = v_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversation not found'; END IF;
  IF v_conv.is_auto THEN RAISE EXCEPTION 'This group''s membership is managed automatically by the school''s records'; END IF;

  SELECT member_role INTO v_me_role FROM conversation_members
  WHERE conversation_id = p_conversation_id AND user_id = auth.uid() AND left_at IS NULL;
  IF v_me_role NOT IN ('owner','admin','moderator') AND NOT is_org_admin(v_org) THEN
    RAISE EXCEPTION 'Only group admins can add members';
  END IF;

  INSERT INTO conversation_members (conversation_id, organization_id, user_id, member_role)
  VALUES (p_conversation_id, v_org, p_user_id, 'member')
  ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL;

  INSERT INTO messaging_audit_log (organization_id, actor_id, action, target_type, target_id, details)
  VALUES (v_org, auth.uid(), 'member_added', 'conversation', p_conversation_id, jsonb_build_object('user_id', p_user_id));
END;
$$;
GRANT EXECUTE ON FUNCTION public.add_group_member(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_group_member(p_conversation_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_me_role text;
  v_conv conversations%ROWTYPE;
BEGIN
  SELECT * INTO v_conv FROM conversations WHERE id = p_conversation_id AND organization_id = v_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversation not found'; END IF;
  IF v_conv.is_auto THEN RAISE EXCEPTION 'This group''s membership is managed automatically by the school''s records'; END IF;

  SELECT member_role INTO v_me_role FROM conversation_members
  WHERE conversation_id = p_conversation_id AND user_id = auth.uid() AND left_at IS NULL;

  IF p_user_id <> auth.uid() THEN
    IF v_me_role NOT IN ('owner','admin','moderator') AND NOT is_org_admin(v_org) THEN
      RAISE EXCEPTION 'Only group admins can remove members';
    END IF;
  END IF;

  UPDATE conversation_members SET left_at = now()
  WHERE conversation_id = p_conversation_id AND user_id = p_user_id AND left_at IS NULL;

  INSERT INTO messaging_audit_log (organization_id, actor_id, action, target_type, target_id, details)
  VALUES (v_org, auth.uid(), 'member_removed', 'conversation', p_conversation_id, jsonb_build_object('user_id', p_user_id));
END;
$$;
GRANT EXECUTE ON FUNCTION public.remove_group_member(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_group(
  p_conversation_id uuid, p_title text DEFAULT NULL, p_description text DEFAULT NULL, p_avatar_url text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_me_role text;
BEGIN
  SELECT member_role INTO v_me_role FROM conversation_members
  WHERE conversation_id = p_conversation_id AND user_id = auth.uid() AND left_at IS NULL;
  IF v_me_role NOT IN ('owner','admin') AND NOT is_org_admin(v_org) THEN
    RAISE EXCEPTION 'Only group admins can edit group details';
  END IF;

  UPDATE conversations SET
    title = COALESCE(p_title, title),
    description = COALESCE(p_description, description),
    avatar_url = COALESCE(p_avatar_url, avatar_url),
    updated_at = now()
  WHERE id = p_conversation_id AND organization_id = v_org;
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_group(uuid, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_group_member_role(p_conversation_id uuid, p_user_id uuid, p_role text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_me_role text;
BEGIN
  IF p_role NOT IN ('admin','moderator','member') THEN RAISE EXCEPTION 'Invalid role'; END IF;
  SELECT member_role INTO v_me_role FROM conversation_members
  WHERE conversation_id = p_conversation_id AND user_id = auth.uid() AND left_at IS NULL;
  IF v_me_role NOT IN ('owner','admin') AND NOT is_org_admin(v_org) THEN
    RAISE EXCEPTION 'Only group admins can change member roles';
  END IF;

  UPDATE conversation_members SET member_role = p_role
  WHERE conversation_id = p_conversation_id AND user_id = p_user_id AND left_at IS NULL AND member_role <> 'owner';
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_group_member_role(uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.archive_conversation(p_conversation_id uuid, p_archived boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM conversation_members
    WHERE conversation_id = p_conversation_id AND user_id = auth.uid() AND left_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Not a member of this conversation';
  END IF;
  UPDATE conversations SET
    archived_at = CASE WHEN p_archived THEN now() ELSE NULL END,
    archived_by = CASE WHEN p_archived THEN auth.uid() ELSE NULL END
  WHERE id = p_conversation_id AND organization_id = v_org;
END;
$$;
GRANT EXECUTE ON FUNCTION public.archive_conversation(uuid, boolean) TO authenticated;

-- ---------------------------------------------------------------------
-- 15. Messaging (send / edit / delete / react / read cursor / pin)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_message(
  p_conversation_id uuid, p_body text DEFAULT NULL, p_message_type text DEFAULT 'text',
  p_reply_to_id uuid DEFAULT NULL, p_attachments jsonb DEFAULT NULL
)
RETURNS messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_me uuid := auth.uid();
  v_conv conversations%ROWTYPE;
  v_msg messages%ROWTYPE;
  v_att jsonb;
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

  INSERT INTO messages (organization_id, conversation_id, sender_id, message_type, body, reply_to_id)
  VALUES (v_org, p_conversation_id, v_me, p_message_type, p_body, p_reply_to_id)
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
GRANT EXECUTE ON FUNCTION public.send_message(uuid, text, text, uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.edit_message(p_message_id uuid, p_body text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_org uuid := current_user_org_id();
BEGIN
  UPDATE messages SET body = p_body, edited_at = now()
  WHERE id = p_message_id AND organization_id = v_org AND sender_id = auth.uid() AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Message not found or not yours to edit'; END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edit_message(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_message(p_message_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_msg messages%ROWTYPE;
  v_me_role text;
BEGIN
  SELECT * INTO v_msg FROM messages WHERE id = p_message_id AND organization_id = v_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Message not found'; END IF;

  IF v_msg.sender_id = auth.uid() THEN
    UPDATE messages SET deleted_at = now(), deleted_by = auth.uid(), body = NULL WHERE id = p_message_id;
    RETURN;
  END IF;

  SELECT member_role INTO v_me_role FROM conversation_members
  WHERE conversation_id = v_msg.conversation_id AND user_id = auth.uid() AND left_at IS NULL;
  IF v_me_role IN ('owner','admin','moderator') THEN
    UPDATE messages SET deleted_at = now(), deleted_by = auth.uid(), body = NULL WHERE id = p_message_id;
    RETURN;
  END IF;

  RAISE EXCEPTION 'You can only delete your own messages';
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_message(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.pin_message(p_message_id uuid, p_pinned boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_msg messages%ROWTYPE;
  v_me_role text;
BEGIN
  SELECT * INTO v_msg FROM messages WHERE id = p_message_id AND organization_id = v_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Message not found'; END IF;
  SELECT member_role INTO v_me_role FROM conversation_members
  WHERE conversation_id = v_msg.conversation_id AND user_id = auth.uid() AND left_at IS NULL;
  IF v_me_role NOT IN ('owner','admin','moderator') THEN
    RAISE EXCEPTION 'Only group admins can pin messages';
  END IF;
  UPDATE messages SET
    pinned_at = CASE WHEN p_pinned THEN now() ELSE NULL END,
    pinned_by = CASE WHEN p_pinned THEN auth.uid() ELSE NULL END
  WHERE id = p_message_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.pin_message(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.react_to_message(p_message_id uuid, p_emoji text)
RETURNS boolean  -- true = reaction added, false = reaction removed (toggle)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_conv_id uuid;
  v_existing uuid;
BEGIN
  SELECT conversation_id INTO v_conv_id FROM messages WHERE id = p_message_id AND organization_id = v_org;
  IF v_conv_id IS NULL THEN RAISE EXCEPTION 'Message not found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM conversation_members WHERE conversation_id = v_conv_id AND user_id = auth.uid() AND left_at IS NULL
  ) THEN
    RAISE EXCEPTION 'You are not a member of this conversation';
  END IF;

  SELECT id INTO v_existing FROM message_reactions
  WHERE message_id = p_message_id AND user_id = auth.uid() AND emoji = p_emoji;

  IF v_existing IS NOT NULL THEN
    DELETE FROM message_reactions WHERE id = v_existing;
    RETURN false;
  ELSE
    INSERT INTO message_reactions (organization_id, message_id, user_id, emoji)
    VALUES (v_org, p_message_id, auth.uid(), p_emoji);
    RETURN true;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.react_to_message(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_messages_read(p_conversation_id uuid, p_up_to timestamptz DEFAULT now())
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE conversation_members
  SET last_read_at = GREATEST(last_read_at, p_up_to)
  WHERE conversation_id = p_conversation_id AND user_id = auth.uid()
    AND organization_id = current_user_org_id();
$$;
GRANT EXECUTE ON FUNCTION public.mark_messages_read(uuid, timestamptz) TO authenticated;

-- ---------------------------------------------------------------------
-- 16. Moderation & safeguarding (Section 9)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_message(
  p_conversation_id uuid, p_message_id uuid DEFAULT NULL, p_reason text DEFAULT 'other', p_details text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_report_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM conversation_members WHERE conversation_id = p_conversation_id AND user_id = auth.uid() AND left_at IS NULL
  ) THEN
    RAISE EXCEPTION 'You are not a member of this conversation';
  END IF;

  INSERT INTO moderation_reports (organization_id, conversation_id, message_id, reported_by, reason, details)
  VALUES (v_org, p_conversation_id, p_message_id, auth.uid(), p_reason, p_details)
  RETURNING id INTO v_report_id;

  INSERT INTO messaging_audit_log (organization_id, actor_id, action, target_type, target_id, details)
  VALUES (v_org, auth.uid(), 'message_reported', 'conversation', p_conversation_id,
          jsonb_build_object('message_id', p_message_id, 'reason', p_reason, 'report_id', v_report_id));

  RETURN v_report_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.report_message(uuid, uuid, text, text) TO authenticated;

-- p_action: 'remove_message' | 'lock_conversation' | 'restrict_user' | 'dismiss'
CREATE OR REPLACE FUNCTION public.moderate_message(p_report_id uuid, p_action text, p_notes text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_report moderation_reports%ROWTYPE;
  v_target_user uuid;
BEGIN
  IF NOT (is_staff_user() AND is_org_admin(v_org)) THEN
    RAISE EXCEPTION 'Only school administrators can moderate messages';
  END IF;
  SELECT * INTO v_report FROM moderation_reports WHERE id = p_report_id AND organization_id = v_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Report not found'; END IF;

  IF p_action = 'remove_message' AND v_report.message_id IS NOT NULL THEN
    UPDATE messages SET deleted_at = now(), deleted_by = auth.uid(), body = NULL, removed_by_moderator = true
    WHERE id = v_report.message_id;
  ELSIF p_action = 'lock_conversation' THEN
    UPDATE conversations SET locked_at = now(), locked_by = auth.uid(), locked_reason = p_notes
    WHERE id = v_report.conversation_id;
  ELSIF p_action = 'restrict_user' THEN
    SELECT sender_id INTO v_target_user FROM messages WHERE id = v_report.message_id;
    IF v_target_user IS NOT NULL THEN
      INSERT INTO messaging_restrictions (organization_id, user_id, restricted_by, reason)
      VALUES (v_org, v_target_user, auth.uid(), COALESCE(p_notes, 'Restricted following a moderation report'));
    END IF;
  ELSIF p_action = 'dismiss' THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'Unknown moderation action: %', p_action;
  END IF;

  UPDATE moderation_reports SET
    status = CASE WHEN p_action = 'dismiss' THEN 'dismissed' ELSE 'actioned' END,
    reviewed_by = auth.uid(), reviewed_at = now(), resolution_notes = p_notes
  WHERE id = p_report_id;

  INSERT INTO messaging_audit_log (organization_id, actor_id, action, target_type, target_id, details)
  VALUES (v_org, auth.uid(), 'report_moderated', 'moderation_report', p_report_id,
          jsonb_build_object('action', p_action, 'notes', p_notes));
END;
$$;
GRANT EXECUTE ON FUNCTION public.moderate_message(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.restrict_user_messaging(p_user_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_org uuid := current_user_org_id();
BEGIN
  IF NOT (is_staff_user() AND is_org_admin(v_org)) THEN
    RAISE EXCEPTION 'Only school administrators can restrict messaging access';
  END IF;
  INSERT INTO messaging_restrictions (organization_id, user_id, restricted_by, reason)
  VALUES (v_org, p_user_id, auth.uid(), p_reason);
  INSERT INTO messaging_audit_log (organization_id, actor_id, action, target_type, target_id, details)
  VALUES (v_org, auth.uid(), 'user_restricted', 'user', p_user_id, jsonb_build_object('reason', p_reason));
END;
$$;
GRANT EXECUTE ON FUNCTION public.restrict_user_messaging(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.lift_user_restriction(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_org uuid := current_user_org_id();
BEGIN
  IF NOT (is_staff_user() AND is_org_admin(v_org)) THEN
    RAISE EXCEPTION 'Only school administrators can lift a restriction';
  END IF;
  UPDATE messaging_restrictions SET active = false, lifted_at = now(), lifted_by = auth.uid()
  WHERE organization_id = v_org AND user_id = p_user_id AND active = true;
  INSERT INTO messaging_audit_log (organization_id, actor_id, action, target_type, target_id, details)
  VALUES (v_org, auth.uid(), 'user_restriction_lifted', 'user', p_user_id, '{}');
END;
$$;
GRANT EXECUTE ON FUNCTION public.lift_user_restriction(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 17. configure_messaging — Section 20 setup/config screen
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.configure_messaging(p_settings jsonb)
RETURNS messaging_policy
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_row messaging_policy%ROWTYPE;
BEGIN
  IF NOT (is_staff_user() AND is_org_admin(v_org)) THEN
    RAISE EXCEPTION 'Only school administrators can configure messaging';
  END IF;

  UPDATE messaging_policy SET
    students_can_message = COALESCE((p_settings->>'students_can_message')::boolean, students_can_message),
    students_can_message_students = COALESCE((p_settings->>'students_can_message_students')::boolean, students_can_message_students),
    students_can_message_teachers = COALESCE((p_settings->>'students_can_message_teachers')::boolean, students_can_message_teachers),
    students_can_initiate_dm = COALESCE((p_settings->>'students_can_initiate_dm')::boolean, students_can_initiate_dm),
    parents_can_message = COALESCE((p_settings->>'parents_can_message')::boolean, parents_can_message),
    parents_can_message_teachers = COALESCE((p_settings->>'parents_can_message_teachers')::boolean, parents_can_message_teachers),
    parents_can_message_staff = COALESCE((p_settings->>'parents_can_message_staff')::boolean, parents_can_message_staff),
    parents_require_child_link = COALESCE((p_settings->>'parents_require_child_link')::boolean, parents_require_child_link),
    teachers_can_message_students = COALESCE((p_settings->>'teachers_can_message_students')::boolean, teachers_can_message_students),
    staff_can_message_all_staff = COALESCE((p_settings->>'staff_can_message_all_staff')::boolean, staff_can_message_all_staff),
    group_creator_roles = CASE WHEN p_settings ? 'group_creator_roles'
      THEN ARRAY(SELECT jsonb_array_elements_text(p_settings->'group_creator_roles')) ELSE group_creator_roles END,
    max_attachment_mb = COALESCE((p_settings->>'max_attachment_mb')::integer, max_attachment_mb),
    admins_can_audit_conversations = COALESCE((p_settings->>'admins_can_audit_conversations')::boolean, admins_can_audit_conversations),
    default_notification_pref = COALESCE(p_settings->>'default_notification_pref', default_notification_pref),
    configured = true,
    configured_by = auth.uid(),
    configured_at = now(),
    updated_at = now()
  WHERE organization_id = v_org
  RETURNING * INTO v_row;

  INSERT INTO messaging_audit_log (organization_id, actor_id, action, target_type, target_id, details)
  VALUES (v_org, auth.uid(), 'messaging_configured', 'messaging_policy', v_row.id, p_settings);

  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.configure_messaging(jsonb) TO authenticated;

-- ---------------------------------------------------------------------
-- 18. Dashboard stats (Section 22)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.messaging_dashboard_stats()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_unread integer;
  v_active_convs integer;
  v_active_groups integer;
  v_pending_reports integer;
BEGIN
  SELECT COUNT(*) INTO v_unread FROM messages m
  JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = auth.uid() AND cm.left_at IS NULL
  WHERE m.organization_id = v_org AND m.created_at > cm.last_read_at AND m.sender_id <> auth.uid()
    AND m.deleted_at IS NULL;

  SELECT COUNT(*) INTO v_active_convs FROM conversation_members cm
  JOIN conversations c ON c.id = cm.conversation_id
  WHERE cm.user_id = auth.uid() AND cm.left_at IS NULL AND c.archived_at IS NULL AND c.organization_id = v_org;

  IF is_staff_user() AND is_org_admin(v_org) THEN
    SELECT COUNT(*) INTO v_active_groups FROM conversations
    WHERE organization_id = v_org AND type <> 'direct' AND archived_at IS NULL;
    SELECT COUNT(*) INTO v_pending_reports FROM moderation_reports
    WHERE organization_id = v_org AND status IN ('open','reviewing');
  ELSE
    v_active_groups := NULL;
    v_pending_reports := NULL;
  END IF;

  RETURN jsonb_build_object(
    'unread_messages', v_unread,
    'active_conversations', v_active_convs,
    'active_groups', v_active_groups,
    'pending_reports', v_pending_reports
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.messaging_dashboard_stats() TO authenticated;

-- ---------------------------------------------------------------------
-- 18b. Read RPCs for the chat UI — pre-joined so the client never has
--      to do N+1 lookups to resolve a sender/other-party's display
--      name across students/staff_members/parent_profiles/profiles.
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
    WHERE m.conversation_id IN (SELECT conversation_id FROM my_convs) AND m.deleted_at IS NULL
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
    WHERE cm.conversation_id IN (SELECT conversation_id FROM my_convs) AND cm.left_at IS NULL
    GROUP BY cm.conversation_id
  ),
  other_member AS (
    SELECT DISTINCT ON (cm.conversation_id) cm.conversation_id, cm.user_id AS other_user_id
    FROM conversation_members cm
    WHERE cm.conversation_id IN (SELECT conversation_id FROM my_convs) AND cm.user_id <> v_me AND cm.left_at IS NULL
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

CREATE OR REPLACE FUNCTION public.get_messages(p_conversation_id uuid, p_before timestamptz DEFAULT NULL, p_limit integer DEFAULT 40)
RETURNS TABLE (
  id uuid, sender_id uuid, sender_name text, sender_role text, message_type text, body text,
  reply_to_id uuid, reply_to_body text, reply_to_sender_id uuid,
  created_at timestamptz, edited_at timestamptz, deleted_at timestamptz, pinned_at timestamptz,
  attachments jsonb, reactions jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_org uuid := current_user_org_id();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM conversation_members WHERE conversation_id = p_conversation_id AND user_id = auth.uid() AND left_at IS NULL
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
        'file_type', a.file_type, 'file_size_bytes', a.file_size_bytes, 'width', a.width, 'height', a.height
      )) FROM message_attachments a WHERE a.message_id = m.id
    ), '[]'::jsonb) AS attachments,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('emoji', r.emoji, 'user_id', r.user_id)) FROM message_reactions r WHERE r.message_id = m.id
    ), '[]'::jsonb) AS reactions
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

CREATE OR REPLACE FUNCTION public.get_conversation_members(p_conversation_id uuid)
RETURNS TABLE (user_id uuid, full_name text, role text, member_role text, muted_at timestamptz, joined_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_org uuid := current_user_org_id();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM conversation_members
    WHERE conversation_id = p_conversation_id AND user_id = auth.uid() AND left_at IS NULL
  ) AND NOT (is_staff_user() AND is_org_admin(v_org)) THEN
    RAISE EXCEPTION 'You are not a member of this conversation';
  END IF;
  RETURN QUERY
  SELECT cm.user_id,
    COALESCE(sm.full_name, s.full_name, pp.full_name, p.full_name, 'Unknown') AS full_name,
    COALESCE(om.role, 'unknown') AS role,
    cm.member_role, cm.muted_at, cm.joined_at
  FROM conversation_members cm
  LEFT JOIN org_memberships om ON om.user_id = cm.user_id AND om.organization_id = v_org
  LEFT JOIN staff_members sm ON sm.user_id = cm.user_id AND sm.organization_id = v_org
  LEFT JOIN students s ON s.profile_id = cm.user_id AND s.organization_id = v_org
  LEFT JOIN parent_profiles pp ON pp.profile_id = cm.user_id AND pp.organization_id = v_org
  LEFT JOIN profiles p ON p.id = cm.user_id
  WHERE cm.conversation_id = p_conversation_id AND cm.left_at IS NULL
  ORDER BY (cm.member_role = 'owner') DESC, (cm.member_role = 'admin') DESC, full_name;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_conversation_members(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_moderation_reports(p_status text DEFAULT NULL)
RETURNS TABLE (
  id uuid, conversation_id uuid, conversation_title text, message_id uuid, message_body text,
  reported_by uuid, reporter_name text, reason text, details text, status text,
  reviewed_by uuid, reviewed_at timestamptz, resolution_notes text, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_org uuid := current_user_org_id();
BEGIN
  IF NOT (is_staff_user() AND is_org_admin(v_org)) THEN
    RAISE EXCEPTION 'Only school administrators can view moderation reports';
  END IF;
  RETURN QUERY
  SELECT
    mr.id, mr.conversation_id, COALESCE(c.title, initcap(c.type)), mr.message_id, m.body,
    mr.reported_by, COALESCE(sm.full_name, s.full_name, pp.full_name, p.full_name, 'Unknown'),
    mr.reason, mr.details, mr.status, mr.reviewed_by, mr.reviewed_at, mr.resolution_notes, mr.created_at
  FROM moderation_reports mr
  JOIN conversations c ON c.id = mr.conversation_id
  LEFT JOIN messages m ON m.id = mr.message_id
  LEFT JOIN staff_members sm ON sm.user_id = mr.reported_by AND sm.organization_id = v_org
  LEFT JOIN students s ON s.profile_id = mr.reported_by AND s.organization_id = v_org
  LEFT JOIN parent_profiles pp ON pp.profile_id = mr.reported_by AND pp.organization_id = v_org
  LEFT JOIN profiles p ON p.id = mr.reported_by
  WHERE mr.organization_id = v_org AND (p_status IS NULL OR mr.status = p_status)
  ORDER BY mr.created_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_moderation_reports(text) TO authenticated;

-- ---------------------------------------------------------------------
-- 19. Storage — message-attachments (PRIVATE, unlike website-media).
--     Files live at <organization_id>/<conversation_id>/<uuid>-<filename>.
--     Served via short-lived signed URLs from the app, never public.
-- ---------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('message-attachments', 'message-attachments', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS message_attachments_tenant_write ON storage.objects;
CREATE POLICY message_attachments_tenant_write ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'message-attachments'
    AND (storage.foldername(name))[1] = current_user_org_id()::text
    AND EXISTS (
      SELECT 1 FROM conversation_members cm
      WHERE cm.conversation_id::text = (storage.foldername(name))[2]
        AND cm.user_id = auth.uid() AND cm.left_at IS NULL
    )
  );

DROP POLICY IF EXISTS message_attachments_tenant_read ON storage.objects;
CREATE POLICY message_attachments_tenant_read ON storage.objects FOR SELECT
  USING (
    bucket_id = 'message-attachments'
    AND (storage.foldername(name))[1] = current_user_org_id()::text
    AND EXISTS (
      SELECT 1 FROM conversation_members cm
      WHERE cm.conversation_id::text = (storage.foldername(name))[2]
        AND cm.user_id = auth.uid() AND cm.left_at IS NULL
    )
  );

DROP POLICY IF EXISTS message_attachments_tenant_delete ON storage.objects;
CREATE POLICY message_attachments_tenant_delete ON storage.objects FOR DELETE
  USING (
    bucket_id = 'message-attachments'
    AND (storage.foldername(name))[1] = current_user_org_id()::text
    AND EXISTS (
      SELECT 1 FROM conversation_members cm
      WHERE cm.conversation_id::text = (storage.foldername(name))[2]
        AND cm.user_id = auth.uid() AND cm.left_at IS NULL
    )
  );

-- ---------------------------------------------------------------------
-- 20. Realtime — publish the tables the chat UI subscribes to.
--     RLS still applies to realtime broadcasts (Supabase enforces the
--     table's SELECT policy per-subscriber), so this is safe to publish
--     broadly; membership rows gate what each client actually receives.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'conversation_members'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE conversation_members;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'message_reactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE message_reactions;
  END IF;
EXCEPTION WHEN undefined_object THEN
  -- supabase_realtime publication doesn't exist in this project yet; the
  -- app falls back gracefully (see src/lib/messaging/realtime.ts) if
  -- realtime events never arrive — polling is not implemented as a
  -- fallback in v1, so this should be verified once in the Supabase
  -- dashboard (Database > Replication) per the deployment steps.
  RAISE NOTICE 'supabase_realtime publication not found — enable replication for messages, conversation_members, message_reactions manually in the Supabase dashboard.';
END $$;

-- ---------------------------------------------------------------------
-- Done. See DEPLOY.md / this migration's header for manual steps:
--   1. Run this file in the Supabase SQL editor (or supabase db push).
--   2. Database > Replication: confirm messages, conversation_members and
--      message_reactions are enabled for realtime (the DO block above
--      attempts this automatically but the publication name can vary).
--   3. Storage: confirm the "message-attachments" bucket was created
--      (private) — no manual action needed beyond that.
-- =====================================================================
