-- =====================================================================
-- NOTIFICATION DELIVERY -- recipient resolution for SMS/email broadcast
-- =====================================================================
-- Run order: after broadcast_channels_module.sql (notification_providers,
-- get_notification_provider_settings, broadcast_announcement_to_inbox) and
-- 20260902180000_communication_module.sql (is_staff_role, conversations
-- schema that broadcast_announcement_to_inbox itself depends on).
--
-- Adds ONE new function. No table is created, no policy is added, dropped
-- or modified, so this is order-independent with respect to
-- rls_role_scoped_access.sql and may be applied any time after the two
-- files above. Idempotent (CREATE OR REPLACE). Manual apply.
--
-- WHY: send.ts (SMS/email dispatch) needs a list of phone numbers/emails
-- for a given announcement scope ('all' | 'staff' | 'parents' | 'students'
-- | 'class'), but nothing computed that before -- only
-- broadcast_announcement_to_inbox() resolves scope to recipients, and it
-- resolves to conversation members, not contact details.
--
-- Rather than re-deriving scope semantics in application code (risking
-- drift between what the in-app inbox broadcasts to and what SMS/email
-- broadcasts to), this function mirrors broadcast_announcement_to_inbox's
-- own scope CASE logic exactly, so all three channels always reach the
-- same population. Contact details come from `profiles` (email NOT NULL,
-- phone nullable) for every user_id case, which the in-app RPC also keys
-- on internally -- ensuring the SAME set of accounts is targeted whether
-- the channel is in-app, SMS, or email.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_broadcast_recipients(
  p_scope text DEFAULT 'all', p_class_id uuid DEFAULT NULL
)
RETURNS TABLE (user_id uuid, phone text, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_me uuid := auth.uid();
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

  IF p_scope = 'all' THEN
    RETURN QUERY
      SELECT DISTINCT p.id, p.phone, p.email
        FROM org_memberships om
        JOIN profiles p ON p.id = om.user_id
       WHERE om.organization_id = v_org AND om.active = true AND om.user_id <> v_me;

  ELSIF p_scope = 'staff' THEN
    RETURN QUERY
      SELECT DISTINCT p.id, p.phone, p.email
        FROM org_memberships om
        JOIN profiles p ON p.id = om.user_id
       WHERE om.organization_id = v_org AND om.active = true
         AND is_staff_role(om.role) AND om.user_id <> v_me;

  ELSIF p_scope = 'parents' THEN
    RETURN QUERY
      SELECT DISTINCT p.id, COALESCE(p.phone, pp.phone), COALESCE(p.email, pp.email)
        FROM parent_profiles pp
        JOIN profiles p ON p.id = pp.profile_id
       WHERE pp.organization_id = v_org AND pp.profile_id IS NOT NULL;

  ELSIF p_scope = 'students' THEN
    RETURN QUERY
      SELECT DISTINCT p.id, COALESCE(p.phone, s.guardian_phone), COALESCE(p.email, s.guardian_email)
        FROM students s
        JOIN profiles p ON p.id = s.profile_id
       WHERE s.organization_id = v_org AND s.status = 'active' AND s.profile_id IS NOT NULL;

  ELSIF p_scope = 'class' THEN
    -- Same three groups as broadcast_announcement_to_inbox's class branch:
    -- parents of the class's active students, the students themselves
    -- (when they have their own login), and the class's assigned teachers.
    RETURN QUERY
      SELECT DISTINCT p.id, COALESCE(p.phone, pp.phone), COALESCE(p.email, pp.email)
        FROM student_enrollments se
        JOIN parent_student_links psl ON psl.student_id = se.student_id
        JOIN parent_profiles pp ON pp.id = psl.parent_id
        JOIN profiles p ON p.id = pp.profile_id
       WHERE se.class_id = p_class_id AND se.status = 'active'
         AND pp.profile_id IS NOT NULL AND pp.organization_id = v_org
      UNION
      SELECT DISTINCT p.id, COALESCE(p.phone, s.guardian_phone), COALESCE(p.email, s.guardian_email)
        FROM students s
        JOIN student_enrollments se ON se.student_id = s.id
        JOIN profiles p ON p.id = s.profile_id
       WHERE se.class_id = p_class_id AND se.status = 'active'
         AND s.profile_id IS NOT NULL AND s.organization_id = v_org
      UNION
      SELECT DISTINCT p.id, p.phone, p.email
        FROM teacher_assignments ta
        JOIN profiles p ON p.id = ta.user_id
       WHERE ta.class_id = p_class_id AND ta.active = true
         AND ta.organization_id = v_org AND ta.user_id <> v_me;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_broadcast_recipients(text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_broadcast_recipients(text, uuid) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------
SELECT 'get_broadcast_recipients' AS function_check, COUNT(*) AS n
FROM pg_proc WHERE proname = 'get_broadcast_recipients';

SELECT 'anon cannot execute' AS check, COUNT(*) AS n
FROM pg_proc p WHERE p.proname = 'get_broadcast_recipients'
  AND has_function_privilege('anon', p.oid, 'EXECUTE');
