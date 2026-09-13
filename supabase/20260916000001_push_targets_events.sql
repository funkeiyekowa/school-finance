-- ============================================================
-- Push notifications: targeting for non-message events
--   (attendance marked, exam published)
--
-- Adds two SERVICE-ROLE-ONLY targeting functions on top of the
-- push_device_tokens registry from 20260915000001. No new tables,
-- no changes to attendance_records / exams / cbt_exam_assignments,
-- and no triggers — both events are invoked explicitly by the app
-- layer right after the existing write succeeds, exactly like
-- push_targets_for_message() is invoked by /api/notifications/push
-- after send_message(). This mirrors that migration's design
-- throughout; read its header comment for the full rationale.
--
-- SECURITY DESIGN NOTES
--
-- Tenant scoping:
--   Both functions take an organization_id implicitly (derived from
--   the row being looked up, e.g. attendance_records.organization_id
--   or exams.organization_id) — never accepted as a bare parameter
--   that could be spoofed. The caller passes only a record id
--   (p_class_id + p_date + p_session, or p_exam_id); every other
--   value is read server-side from the row itself.
--
-- Recipient resolution — attendance:
--   attendance_records has no direct parent link. Recipients are
--   resolved student_id -> parent_student_links -> parent_profiles
--   -> push_device_tokens, exactly the reverse of my_linked_student_ids().
--   Only parents whose profile_id has an active (revoked_at IS NULL)
--   token receive anything; a parent with no device gets nothing, not
--   an error.
--
-- Recipient resolution — exam published:
--   cbt_exam_assignments rows (student_id or class_id) are the
--   authoritative assignment surface; when an exam has none, the
--   direct exams.class_id column is the fallback — the same fallback
--   can_take_exam() already uses, so targeting can never notify a
--   wider audience than the one actually able to sit the exam.
--   Recipients are the assigned students' PARENTS (same
--   parent_student_links join as above) — students who use the
--   mobile exam list see it there already; this is the "tell a
--   parent their child has an exam" notification, not a duplicate
--   in-app alert to the student.
--
-- Service-role-only functions:
--   Both are SECURITY DEFINER, EXECUTE granted to service_role ONLY.
--   REVOKE ... FROM PUBLIC is explicit because Postgres grants EXECUTE
--   to PUBLIC by default on new functions. A signed-in client can
--   never call these directly and can never enumerate tokens.
--
-- Idempotent. Safe to re-run.
-- DOES NOT modify attendance_records, exams, cbt_exam_assignments,
-- or any attendance/CBT RPC. Adds two new functions only.
-- DO NOT apply to Production without explicit authorization.
-- ============================================================

-- ------------------------------------------------------------
-- 1. push_targets_for_attendance — SERVICE ROLE ONLY
--    "Attendance was just marked for this class/date/session —
--    who (which parents) should be told?"
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.push_targets_for_attendance(
  p_class_id   uuid,
  p_date       date,
  p_session    text,
  p_subject_id uuid DEFAULT NULL
)
RETURNS TABLE (
  user_id         uuid,
  expo_push_token text,
  title           text,
  body            text,
  student_id      uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH marks AS (
    SELECT ar.student_id, ar.status_code, ar.organization_id
    FROM public.attendance_records ar
    WHERE ar.class_id = p_class_id
      AND ar.date = p_date
      AND ar.session = p_session
      AND (p_subject_id IS NULL AND ar.subject_id IS NULL
           OR ar.subject_id = p_subject_id)
  ),
  st AS (
    SELECT m.student_id, m.status_code, m.organization_id,
           COALESCE(s.full_name, 'Your child') AS student_name
    FROM marks m
    LEFT JOIN public.students s ON s.id = m.student_id
  ),
  recipients AS (
    SELECT
      st.student_id,
      st.status_code,
      st.student_name,
      pp.profile_id AS user_id
    FROM st
    JOIN public.parent_student_links psl ON psl.student_id = st.student_id
    JOIN public.parent_profiles pp ON pp.id = psl.parent_id
    WHERE pp.profile_id IS NOT NULL
  )
  SELECT
    r.user_id,
    t.expo_push_token,
    'Attendance update' AS title,
    r.student_name || ' was marked ' ||
      CASE r.status_code
        WHEN 'present' THEN 'present'
        WHEN 'absent'  THEN 'absent'
        WHEN 'late'    THEN 'late'
        WHEN 'excused' THEN 'excused'
        WHEN 'sick'    THEN 'sick'
        ELSE r.status_code
      END || ' today' AS body,
    r.student_id
  FROM recipients r
  JOIN public.push_device_tokens t
    ON t.user_id = r.user_id
   AND t.revoked_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.push_targets_for_attendance(uuid, date, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.push_targets_for_attendance(uuid, date, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.push_targets_for_attendance(uuid, date, text, uuid) TO service_role;

-- ------------------------------------------------------------
-- 2. push_targets_for_exam — SERVICE ROLE ONLY
--    "This exam was just published — whose parents should be told?"
--
--    Assignment resolution mirrors can_take_exam(): prefer explicit
--    cbt_exam_assignments rows (by student_id or class_id); if an
--    exam has none at all, fall back to the exam's own class_id.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.push_targets_for_exam(p_exam_id uuid)
RETURNS TABLE (
  user_id         uuid,
  expo_push_token text,
  title           text,
  body            text,
  student_id      uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ex AS (
    SELECT e.id, e.title, e.class_id, e.organization_id
    FROM public.exams e
    WHERE e.id = p_exam_id
      AND e.status = 'published'
  ),
  has_assignments AS (
    SELECT EXISTS (
      SELECT 1 FROM public.cbt_exam_assignments a WHERE a.exam_id = p_exam_id
    ) AS present
  ),
  assigned_students AS (
    -- Explicit per-student assignments.
    SELECT a.student_id
    FROM public.cbt_exam_assignments a, has_assignments ha
    WHERE a.exam_id = p_exam_id
      AND ha.present
      AND a.student_id IS NOT NULL
    UNION
    -- Explicit per-class assignments -> enrolled students.
    SELECT ce.student_id
    FROM public.cbt_exam_assignments a
    JOIN public.class_enrollments ce ON ce.class_id = a.class_id
    CROSS JOIN has_assignments ha
    WHERE a.exam_id = p_exam_id
      AND ha.present
      AND a.class_id IS NOT NULL
    UNION
    -- No assignment rows at all -> fall back to the exam's own
    -- class_id, exactly like can_take_exam()'s fallback.
    SELECT ce.student_id
    FROM ex
    JOIN public.class_enrollments ce ON ce.class_id = ex.class_id
    CROSS JOIN has_assignments ha
    WHERE NOT ha.present
      AND ex.class_id IS NOT NULL
  ),
  recipients AS (
    SELECT DISTINCT
      asn.student_id,
      pp.profile_id AS user_id
    FROM assigned_students asn
    JOIN public.parent_student_links psl ON psl.student_id = asn.student_id
    JOIN public.parent_profiles pp ON pp.id = psl.parent_id
    WHERE pp.profile_id IS NOT NULL
  )
  SELECT
    r.user_id,
    t.expo_push_token,
    'New exam available' AS title,
    COALESCE((SELECT ex.title FROM ex), 'An exam') || ' is now available' AS body,
    r.student_id
  FROM recipients r
  JOIN public.push_device_tokens t
    ON t.user_id = r.user_id
   AND t.revoked_at IS NULL
  WHERE EXISTS (SELECT 1 FROM ex);
$$;

REVOKE ALL ON FUNCTION public.push_targets_for_exam(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.push_targets_for_exam(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.push_targets_for_exam(uuid) TO service_role;

-- ============================================================
-- VERIFY
-- Expect: push_targets_for_attendance + push_targets_for_exam
-- granted to service_role ONLY (no anon, no authenticated).
-- ============================================================
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
  AND p.proname IN ('push_targets_for_attendance', 'push_targets_for_exam')
GROUP BY p.proname
ORDER BY p.proname;
