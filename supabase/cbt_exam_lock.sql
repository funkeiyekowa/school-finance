-- ============================================================
-- CBT Exam Lock — authoritative "which exam is this student locked to"
-- ============================================================
-- Run order: after cbt_ai_integration.sql (#71), already in supabase/README.md.
--   Idempotent — safe to re-run. No data changes; adds one read-only RPC and
--   a supporting index.
--
-- get_active_exam_lock() returns the attempt_id + exam_id of the CALLER's own
-- in-progress attempt, if any. This is the server-side signal that puts a
-- student into EXAM LOCK MODE: while it returns a row, the app (middleware +
-- shell) confines the student to that exam's take page.
--
-- IMPORTANT difference from has_active_exam_attempt(): this matches ONLY the
-- student's OWN attempt (students.profile_id = auth.uid()) — it deliberately
-- does NOT include a parent's linked children. Locking must trap the student
-- who is sitting the exam, never a parent who merely has a child mid-exam.
-- has_active_exam_attempt() keeps its broader definition for the AI interlock.

CREATE OR REPLACE FUNCTION public.get_active_exam_lock()
RETURNS TABLE (attempt_id uuid, exam_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT ea.id, ea.exam_id
  FROM public.exam_attempts ea
  WHERE ea.status = 'in_progress'
    AND ea.student_id IN (SELECT id FROM public.students WHERE profile_id = auth.uid())
  ORDER BY ea.started_at DESC
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_active_exam_lock() TO authenticated;

-- Speeds up the lock lookup (and the runner's resume query): find a student's
-- in-progress attempt quickly. Partial index keeps it tiny.
CREATE INDEX IF NOT EXISTS idx_exam_attempts_student_inprogress
  ON public.exam_attempts (student_id)
  WHERE status = 'in_progress';

-- ------------------------------------------------------------
-- Verification
-- ------------------------------------------------------------
SELECT proname, pg_get_function_identity_arguments(oid) AS args
FROM pg_proc WHERE proname = 'get_active_exam_lock';

-- Should return 0 rows for a service-role/no-auth caller (auth.uid() is null):
SELECT * FROM public.get_active_exam_lock();
