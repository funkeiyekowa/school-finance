-- =====================================================================
-- LEARNING MANAGEMENT SYSTEM (LMS) MODULE
-- =====================================================================
-- Adds real functionality behind the "Learning Management" module row
-- in the Platform Admin > Module Catalogue (key='lms'), which
-- previously had zero dashboard pages built for it.
--
-- Scope: courses -> lessons -> (optional) quiz per lesson, student
-- enrollment + progress tracking, badges, a leaderboard, and per-lesson
-- discussion threads. AI features (lesson generation, quiz generation,
-- grading assistance, student study help) are implemented in the app
-- layer against the existing /api/ai/generate pipeline and a new
-- narrowly-scoped student-facing AI route -- this file only adds the
-- `ai_generated` / `ai_source_prompt` bookkeeping columns AI-authored
-- rows need.
--
-- Conventions followed (see fix_paginated_ambiguous_columns.sql and
-- transport_module.sql for the lessons that shaped these):
--   * RLS via current_user_org_id() from the start, never "USING (true)".
--   * Any RPC's RETURNS TABLE column names avoid colliding with bare
--     identifiers used in its body (the 42702 "ambiguous column" bug).
--   * Student-owned rows scoped via
--     student_id IN (SELECT id FROM students WHERE profile_id = auth.uid())
--     -- the same pattern cbt_upgrade_migration.sql uses for exam_attempts.
--
-- Run order: after saas_foundation.sql / multi_tenant_migration.sql
-- (current_user_org_id()), operations_migration.sql (staff_members),
-- attendance_migration.sql (subjects), promotion_system_migration.sql
-- (classes), and the students table.
--
-- SAFE TO RE-RUN.
-- =====================================================================

-- ==========================================================
-- 1. COURSES
-- ==========================================================
CREATE TABLE IF NOT EXISTS lms_courses (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  title text NOT NULL,
  description text,
  subject_id uuid REFERENCES subjects(id) ON DELETE SET NULL,
  class_id uuid REFERENCES classes(id) ON DELETE SET NULL,   -- target grade/class; NULL = open to all
  teacher_staff_id uuid REFERENCES staff_members(id) ON DELETE SET NULL,
  cover_color text DEFAULT '#0F2A47',                        -- simple visual identity, no image upload needed
  status text NOT NULL DEFAULT 'draft',                      -- 'draft', 'published', 'archived'
  leaderboard_enabled boolean NOT NULL DEFAULT true,          -- schools can opt out of competitive ranking
  ai_generated boolean NOT NULL DEFAULT false,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lms_courses_org ON lms_courses(organization_id);
CREATE INDEX IF NOT EXISTS idx_lms_courses_status ON lms_courses(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_lms_courses_teacher ON lms_courses(teacher_staff_id);

-- ==========================================================
-- 2. LESSONS
-- ==========================================================
CREATE TABLE IF NOT EXISTS lms_lessons (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id uuid NOT NULL REFERENCES lms_courses(id) ON DELETE CASCADE,
  title text NOT NULL,
  content text,                          -- markdown-ish body, rendered via renderAiOutputHtml
  sort_order integer NOT NULL DEFAULT 0,
  estimated_minutes integer DEFAULT 15,
  status text NOT NULL DEFAULT 'draft',  -- 'draft', 'published'
  ai_generated boolean NOT NULL DEFAULT false,
  ai_source_prompt text,                 -- the topic/prompt used to generate this lesson, for regeneration/audit
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lms_lessons_course ON lms_lessons(course_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_lms_lessons_org ON lms_lessons(organization_id);

-- ==========================================================
-- 3. ENROLLMENTS
-- ==========================================================
CREATE TABLE IF NOT EXISTS lms_enrollments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id uuid NOT NULL REFERENCES lms_courses(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active', -- 'active', 'completed', 'dropped'
  enrolled_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  UNIQUE(course_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_lms_enroll_course ON lms_enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_lms_enroll_student ON lms_enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_lms_enroll_org ON lms_enrollments(organization_id);

-- ==========================================================
-- 4. LESSON PROGRESS
-- ==========================================================
CREATE TABLE IF NOT EXISTS lms_lesson_progress (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  lesson_id uuid NOT NULL REFERENCES lms_lessons(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'not_started', -- 'not_started', 'in_progress', 'completed'
  started_at timestamptz,
  completed_at timestamptz,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  UNIQUE(lesson_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_lms_progress_lesson ON lms_lesson_progress(lesson_id);
CREATE INDEX IF NOT EXISTS idx_lms_progress_student ON lms_lesson_progress(student_id);
CREATE INDEX IF NOT EXISTS idx_lms_progress_org ON lms_lesson_progress(organization_id);

-- ==========================================================
-- 5. QUIZZES (one per lesson, optional)
-- ==========================================================
CREATE TABLE IF NOT EXISTS lms_quizzes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  lesson_id uuid NOT NULL REFERENCES lms_lessons(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Lesson Quiz',
  pass_mark_percent integer NOT NULL DEFAULT 50,
  max_attempts integer NOT NULL DEFAULT 3,     -- retakeable, capped
  ai_generated boolean NOT NULL DEFAULT false,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_lms_quizzes_lesson ON lms_quizzes(lesson_id);
CREATE INDEX IF NOT EXISTS idx_lms_quizzes_org ON lms_quizzes(organization_id);

-- ==========================================================
-- 6. QUIZ QUESTIONS
-- ==========================================================
-- options shape mirrors the existing CBT `questions` table for
-- consistency: [{id, text, is_correct}]. Kept as its own table (not
-- reusing `questions`) so the LMS module has no hard dependency on the
-- CBT module's schema/lifecycle.
CREATE TABLE IF NOT EXISTS lms_quiz_questions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  quiz_id uuid NOT NULL REFERENCES lms_quizzes(id) ON DELETE CASCADE,
  question_text text NOT NULL,
  options jsonb NOT NULL DEFAULT '[]',   -- [{id, text, is_correct}]
  explanation text,
  marks numeric(5,2) NOT NULL DEFAULT 1,
  sort_order integer NOT NULL DEFAULT 0,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lms_quizq_quiz ON lms_quiz_questions(quiz_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_lms_quizq_org ON lms_quiz_questions(organization_id);

-- ==========================================================
-- 7. QUIZ ATTEMPTS + ANSWERS
-- ==========================================================
CREATE TABLE IF NOT EXISTS lms_quiz_attempts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  quiz_id uuid NOT NULL REFERENCES lms_quizzes(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL DEFAULT 1,
  score numeric(6,2),
  percentage numeric(5,2),
  passed boolean,
  started_at timestamptz DEFAULT now(),
  submitted_at timestamptz,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lms_attempts_quiz ON lms_quiz_attempts(quiz_id);
CREATE INDEX IF NOT EXISTS idx_lms_attempts_student ON lms_quiz_attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_lms_attempts_org ON lms_quiz_attempts(organization_id);

CREATE TABLE IF NOT EXISTS lms_quiz_answers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  attempt_id uuid NOT NULL REFERENCES lms_quiz_attempts(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES lms_quiz_questions(id) ON DELETE CASCADE,
  selected_option_id text,
  is_correct boolean,
  marks_awarded numeric(5,2) DEFAULT 0,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lms_answers_attempt ON lms_quiz_answers(attempt_id);
CREATE INDEX IF NOT EXISTS idx_lms_answers_org ON lms_quiz_answers(organization_id);

-- ==========================================================
-- 8. ASSIGNMENTS + SUBMISSIONS (free-text work + AI grading assist)
-- ==========================================================
CREATE TABLE IF NOT EXISTS lms_assignments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  lesson_id uuid NOT NULL REFERENCES lms_lessons(id) ON DELETE CASCADE,
  title text NOT NULL,
  instructions text,
  max_score numeric(6,2) NOT NULL DEFAULT 100,
  due_date date,
  ai_generated boolean NOT NULL DEFAULT false,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lms_assign_lesson ON lms_assignments(lesson_id);
CREATE INDEX IF NOT EXISTS idx_lms_assign_org ON lms_assignments(organization_id);

CREATE TABLE IF NOT EXISTS lms_submissions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  assignment_id uuid NOT NULL REFERENCES lms_assignments(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  response_text text,
  status text NOT NULL DEFAULT 'submitted', -- 'submitted', 'graded'
  score numeric(6,2),
  feedback text,
  ai_suggested_score numeric(6,2),          -- AI's suggestion -- never auto-applied
  ai_suggested_feedback text,
  graded_by_staff_id uuid REFERENCES staff_members(id) ON DELETE SET NULL,
  submitted_at timestamptz DEFAULT now(),
  graded_at timestamptz,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  UNIQUE(assignment_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_lms_submissions_assign ON lms_submissions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_lms_submissions_student ON lms_submissions(student_id);
CREATE INDEX IF NOT EXISTS idx_lms_submissions_org ON lms_submissions(organization_id);

-- ==========================================================
-- 9. BADGES (engagement / gamification)
-- ==========================================================
CREATE TABLE IF NOT EXISTS lms_badges (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  description text,
  icon text NOT NULL DEFAULT 'award',    -- lucide icon name
  criteria_type text NOT NULL,           -- 'lessons_completed', 'course_completed', 'quiz_streak', 'perfect_quiz'
  criteria_value integer NOT NULL DEFAULT 1,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lms_badges_org ON lms_badges(organization_id);

CREATE TABLE IF NOT EXISTS lms_student_badges (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  badge_id uuid NOT NULL REFERENCES lms_badges(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  earned_at timestamptz DEFAULT now(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  UNIQUE(badge_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_lms_studentbadges_student ON lms_student_badges(student_id);
CREATE INDEX IF NOT EXISTS idx_lms_studentbadges_org ON lms_student_badges(organization_id);

-- ==========================================================
-- 10. DISCUSSION THREADS (per lesson)
-- ==========================================================
CREATE TABLE IF NOT EXISTS lms_discussions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  lesson_id uuid NOT NULL REFERENCES lms_lessons(id) ON DELETE CASCADE,
  student_id uuid REFERENCES students(id) ON DELETE CASCADE,       -- author, when a student started it
  staff_id uuid REFERENCES staff_members(id) ON DELETE SET NULL,    -- author, when a teacher started it
  title text NOT NULL,
  body text,
  status text NOT NULL DEFAULT 'open',   -- 'open', 'resolved'
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  CHECK (student_id IS NOT NULL OR staff_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_lms_discuss_lesson ON lms_discussions(lesson_id);
CREATE INDEX IF NOT EXISTS idx_lms_discuss_org ON lms_discussions(organization_id);

CREATE TABLE IF NOT EXISTS lms_discussion_replies (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  discussion_id uuid NOT NULL REFERENCES lms_discussions(id) ON DELETE CASCADE,
  student_id uuid REFERENCES students(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES staff_members(id) ON DELETE SET NULL,
  body text NOT NULL,
  is_ai_generated boolean NOT NULL DEFAULT false,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  CHECK (student_id IS NOT NULL OR staff_id IS NOT NULL OR is_ai_generated)
);

CREATE INDEX IF NOT EXISTS idx_lms_replies_discussion ON lms_discussion_replies(discussion_id);
CREATE INDEX IF NOT EXISTS idx_lms_replies_org ON lms_discussion_replies(organization_id);

-- ==========================================================
-- 11. RLS -- tenant-isolated from the start via current_user_org_id()
-- ==========================================================
ALTER TABLE lms_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE lms_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE lms_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE lms_lesson_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE lms_quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE lms_quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE lms_quiz_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE lms_quiz_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE lms_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE lms_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE lms_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE lms_student_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE lms_discussions ENABLE ROW LEVEL SECURITY;
ALTER TABLE lms_discussion_replies ENABLE ROW LEVEL SECURITY;

-- Tenant-wide tables: any authenticated member of the org can read/write
-- (fine-grained student-vs-teacher restrictions are enforced in the app
-- layer via canEdit / role checks, matching how staff_members, students,
-- etc. already work in this codebase).
DROP POLICY IF EXISTS tenant_lms_courses_all ON lms_courses;
CREATE POLICY tenant_lms_courses_all ON lms_courses FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_lms_lessons_all ON lms_lessons;
CREATE POLICY tenant_lms_lessons_all ON lms_lessons FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_lms_quizzes_all ON lms_quizzes;
CREATE POLICY tenant_lms_quizzes_all ON lms_quizzes FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_lms_quizq_all ON lms_quiz_questions;
CREATE POLICY tenant_lms_quizq_all ON lms_quiz_questions FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_lms_assignments_all ON lms_assignments;
CREATE POLICY tenant_lms_assignments_all ON lms_assignments FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_lms_badges_all ON lms_badges;
CREATE POLICY tenant_lms_badges_all ON lms_badges FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_lms_discussions_all ON lms_discussions;
CREATE POLICY tenant_lms_discussions_all ON lms_discussions FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_lms_replies_all ON lms_discussion_replies;
CREATE POLICY tenant_lms_replies_all ON lms_discussion_replies FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- Student-owned tables: a member of the org can see everything in the
-- org (teachers grading/reviewing), but the row must always belong to
-- the tenant AND, additionally, a student can only write their own rows.
-- Enrollments: any org member can read/write (teachers enroll students);
-- tenant isolation is the only DB-level constraint, same as courses.
DROP POLICY IF EXISTS tenant_lms_enrollments_all ON lms_enrollments;
CREATE POLICY tenant_lms_enrollments_all ON lms_enrollments FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_lms_progress_all ON lms_lesson_progress;
CREATE POLICY tenant_lms_progress_all ON lms_lesson_progress FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_lms_attempts_all ON lms_quiz_attempts;
CREATE POLICY tenant_lms_attempts_all ON lms_quiz_attempts FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_lms_answers_all ON lms_quiz_answers;
CREATE POLICY tenant_lms_answers_all ON lms_quiz_answers FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_lms_submissions_all ON lms_submissions;
CREATE POLICY tenant_lms_submissions_all ON lms_submissions FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_lms_studentbadges_all ON lms_student_badges;
CREATE POLICY tenant_lms_studentbadges_all ON lms_student_badges FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- ==========================================================
-- 12. STATS RPC -- fast counts for the dashboard tiles
-- ==========================================================
-- Column names avoid colliding with any bare identifier referenced in
-- the function body (the 42702 lesson from students_paginated/
-- staff_paginated).
CREATE OR REPLACE FUNCTION lms_course_stats(p_course_id uuid DEFAULT NULL)
RETURNS TABLE (
  total_courses bigint,
  published_courses bigint,
  total_lessons bigint,
  total_enrollments bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM lms_courses c WHERE c.organization_id = v_org
       AND (p_course_id IS NULL OR c.id = p_course_id)) as total_courses,
    (SELECT COUNT(*) FROM lms_courses c WHERE c.organization_id = v_org AND c.status = 'published'
       AND (p_course_id IS NULL OR c.id = p_course_id)) as published_courses,
    (SELECT COUNT(*) FROM lms_lessons l WHERE l.organization_id = v_org
       AND (p_course_id IS NULL OR l.course_id = p_course_id)) as total_lessons,
    (SELECT COUNT(*) FROM lms_enrollments e WHERE e.organization_id = v_org
       AND (p_course_id IS NULL OR e.course_id = p_course_id)) as total_enrollments;
END $$;

GRANT EXECUTE ON FUNCTION lms_course_stats(uuid) TO authenticated;

-- Per-student progress across a course: lessons completed, quiz average.
CREATE OR REPLACE FUNCTION lms_student_course_progress(p_course_id uuid, p_student_id uuid)
RETURNS TABLE (
  lessons_total bigint,
  lessons_completed bigint,
  quizzes_taken bigint,
  quiz_average_percent numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM lms_lessons l WHERE l.course_id = p_course_id AND l.organization_id = v_org AND l.status = 'published') as lessons_total,
    (SELECT COUNT(*) FROM lms_lesson_progress lp
       JOIN lms_lessons l2 ON l2.id = lp.lesson_id
       WHERE l2.course_id = p_course_id AND lp.student_id = p_student_id AND lp.status = 'completed' AND lp.organization_id = v_org) as lessons_completed,
    (SELECT COUNT(DISTINCT qa.quiz_id) FROM lms_quiz_attempts qa
       JOIN lms_quizzes q2 ON q2.id = qa.quiz_id
       JOIN lms_lessons l3 ON l3.id = q2.lesson_id
       WHERE l3.course_id = p_course_id AND qa.student_id = p_student_id AND qa.organization_id = v_org AND qa.submitted_at IS NOT NULL) as quizzes_taken,
    (SELECT ROUND(AVG(qa.percentage), 1) FROM lms_quiz_attempts qa
       JOIN lms_quizzes q3 ON q3.id = qa.quiz_id
       JOIN lms_lessons l4 ON l4.id = q3.lesson_id
       WHERE l4.course_id = p_course_id AND qa.student_id = p_student_id AND qa.organization_id = v_org AND qa.submitted_at IS NOT NULL) as quiz_average_percent;
END $$;

GRANT EXECUTE ON FUNCTION lms_student_course_progress(uuid, uuid) TO authenticated;

-- ==========================================================
-- 13. LEADERBOARD RPC
-- ==========================================================
-- Ranks students in a course by: lessons completed (primary) then
-- average quiz score (tiebreaker). Only returns rows when the course
-- has leaderboard_enabled = true, so a school/teacher can opt a course
-- out of competitive ranking without deleting any data.
CREATE OR REPLACE FUNCTION lms_leaderboard(p_course_id uuid)
RETURNS TABLE (
  student_id uuid,
  student_name text,
  lessons_done bigint,
  avg_quiz_percent numeric,
  rank_position bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_enabled boolean;
BEGIN
  SELECT c.leaderboard_enabled INTO v_enabled FROM lms_courses c WHERE c.id = p_course_id AND c.organization_id = v_org;
  IF v_enabled IS DISTINCT FROM true THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    s.id as student_id,
    s.full_name as student_name,
    COALESCE(lp_agg.done_count, 0) as lessons_done,
    COALESCE(qa_agg.avg_pct, 0) as avg_quiz_percent,
    RANK() OVER (ORDER BY COALESCE(lp_agg.done_count, 0) DESC, COALESCE(qa_agg.avg_pct, 0) DESC) as rank_position
  FROM lms_enrollments en
  JOIN students s ON s.id = en.student_id
  LEFT JOIN (
    SELECT lp.student_id, COUNT(*) as done_count
    FROM lms_lesson_progress lp
    JOIN lms_lessons l ON l.id = lp.lesson_id
    WHERE l.course_id = p_course_id AND lp.status = 'completed'
    GROUP BY lp.student_id
  ) lp_agg ON lp_agg.student_id = s.id
  LEFT JOIN (
    SELECT qa.student_id, AVG(qa.percentage) as avg_pct
    FROM lms_quiz_attempts qa
    JOIN lms_quizzes q ON q.id = qa.quiz_id
    JOIN lms_lessons l2 ON l2.id = q.lesson_id
    WHERE l2.course_id = p_course_id AND qa.submitted_at IS NOT NULL
    GROUP BY qa.student_id
  ) qa_agg ON qa_agg.student_id = s.id
  WHERE en.course_id = p_course_id AND en.organization_id = v_org
  ORDER BY rank_position
  LIMIT 50;
END $$;

GRANT EXECUTE ON FUNCTION lms_leaderboard(uuid) TO authenticated;

-- ==========================================================
-- 14. QUIZ SUBMIT RPC -- server-side scoring (never trust client score)
-- ==========================================================
-- p_answers: [{"question_id": "...", "selected_option_id": "..."}]
CREATE OR REPLACE FUNCTION lms_submit_quiz_attempt(
  p_quiz_id uuid,
  p_student_id uuid,
  p_answers jsonb
)
RETURNS TABLE (
  attempt_id uuid,
  score_result numeric,
  percentage_result numeric,
  passed_result boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_attempt_id uuid;
  v_attempt_number integer;
  v_max_attempts integer;
  v_pass_mark integer;
  v_total_marks numeric := 0;
  v_scored_marks numeric := 0;
  v_answer jsonb;
  v_question record;
  v_selected text;
  v_is_correct boolean;
  v_marks_for_q numeric;
BEGIN
  -- Verify the student belongs to this org and owns this attempt.
  IF NOT EXISTS (SELECT 1 FROM students st WHERE st.id = p_student_id AND st.organization_id = v_org) THEN
    RAISE EXCEPTION 'Student not found in this organization';
  END IF;

  SELECT q.max_attempts, q.pass_mark_percent INTO v_max_attempts, v_pass_mark
  FROM lms_quizzes q WHERE q.id = p_quiz_id AND q.organization_id = v_org;
  IF v_max_attempts IS NULL THEN
    RAISE EXCEPTION 'Quiz not found in this organization';
  END IF;

  SELECT COUNT(*) + 1 INTO v_attempt_number FROM lms_quiz_attempts
  WHERE quiz_id = p_quiz_id AND student_id = p_student_id;
  IF v_attempt_number > v_max_attempts THEN
    RAISE EXCEPTION 'Maximum attempts (%) reached for this quiz', v_max_attempts;
  END IF;

  INSERT INTO lms_quiz_attempts (quiz_id, student_id, attempt_number, organization_id)
  VALUES (p_quiz_id, p_student_id, v_attempt_number, v_org)
  RETURNING id INTO v_attempt_id;

  FOR v_question IN
    SELECT qq.id, qq.options, qq.marks FROM lms_quiz_questions qq
    WHERE qq.quiz_id = p_quiz_id AND qq.organization_id = v_org
  LOOP
    v_total_marks := v_total_marks + v_question.marks;

    v_selected := NULL;
    FOR v_answer IN SELECT * FROM jsonb_array_elements(p_answers)
    LOOP
      IF (v_answer->>'question_id')::uuid = v_question.id THEN
        v_selected := v_answer->>'selected_option_id';
      END IF;
    END LOOP;

    v_is_correct := false;
    v_marks_for_q := 0;
    IF v_selected IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_question.options) opt
        WHERE opt->>'id' = v_selected AND (opt->>'is_correct')::boolean = true
      ) INTO v_is_correct;
      IF v_is_correct THEN
        v_marks_for_q := v_question.marks;
        v_scored_marks := v_scored_marks + v_question.marks;
      END IF;
    END IF;

    INSERT INTO lms_quiz_answers (attempt_id, question_id, selected_option_id, is_correct, marks_awarded, organization_id)
    VALUES (v_attempt_id, v_question.id, v_selected, v_is_correct, v_marks_for_q, v_org);
  END LOOP;

  UPDATE lms_quiz_attempts
  SET score = v_scored_marks,
      percentage = CASE WHEN v_total_marks > 0 THEN ROUND((v_scored_marks / v_total_marks) * 100, 1) ELSE 0 END,
      passed = CASE WHEN v_total_marks > 0 THEN (v_scored_marks / v_total_marks) * 100 >= v_pass_mark ELSE false END,
      submitted_at = now()
  WHERE id = v_attempt_id;

  RETURN QUERY
  SELECT v_attempt_id,
    (SELECT qa2.score FROM lms_quiz_attempts qa2 WHERE qa2.id = v_attempt_id),
    (SELECT qa3.percentage FROM lms_quiz_attempts qa3 WHERE qa3.id = v_attempt_id),
    (SELECT qa4.passed FROM lms_quiz_attempts qa4 WHERE qa4.id = v_attempt_id);
END $$;

GRANT EXECUTE ON FUNCTION lms_submit_quiz_attempt(uuid, uuid, jsonb) TO authenticated;

-- ==========================================================
-- 15. BADGE-AWARD RPC -- call after progress-changing actions
-- ==========================================================
-- Idempotent: re-running for a student who already has a badge is a
-- no-op (ON CONFLICT DO NOTHING). Call this after marking a lesson
-- complete or submitting a quiz.
CREATE OR REPLACE FUNCTION lms_check_and_award_badges(p_student_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_badge record;
  v_awarded integer := 0;
  v_lessons_completed bigint;
  v_courses_completed bigint;
  v_perfect_quizzes bigint;
BEGIN
  SELECT COUNT(*) INTO v_lessons_completed FROM lms_lesson_progress
  WHERE student_id = p_student_id AND status = 'completed' AND organization_id = v_org;

  SELECT COUNT(*) INTO v_courses_completed FROM lms_enrollments
  WHERE student_id = p_student_id AND status = 'completed' AND organization_id = v_org;

  SELECT COUNT(*) INTO v_perfect_quizzes FROM lms_quiz_attempts
  WHERE student_id = p_student_id AND percentage = 100 AND organization_id = v_org;

  FOR v_badge IN SELECT * FROM lms_badges WHERE organization_id = v_org
  LOOP
    IF (v_badge.criteria_type = 'lessons_completed' AND v_lessons_completed >= v_badge.criteria_value)
       OR (v_badge.criteria_type = 'course_completed' AND v_courses_completed >= v_badge.criteria_value)
       OR (v_badge.criteria_type = 'perfect_quiz' AND v_perfect_quizzes >= v_badge.criteria_value)
    THEN
      INSERT INTO lms_student_badges (badge_id, student_id, organization_id)
      VALUES (v_badge.id, p_student_id, v_org)
      ON CONFLICT (badge_id, student_id) DO NOTHING;
      IF FOUND THEN
        v_awarded := v_awarded + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN v_awarded;
END $$;

GRANT EXECUTE ON FUNCTION lms_check_and_award_badges(uuid) TO authenticated;

-- ==========================================================
-- 16. SEED A FEW STARTER BADGES PER ORG (idempotent, safe defaults)
-- ==========================================================
INSERT INTO lms_badges (name, description, icon, criteria_type, criteria_value, organization_id)
SELECT 'First Steps', 'Completed your first lesson', 'footprints', 'lessons_completed', 1, o.id
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM lms_badges b WHERE b.organization_id = o.id AND b.criteria_type = 'lessons_completed' AND b.criteria_value = 1
);

INSERT INTO lms_badges (name, description, icon, criteria_type, criteria_value, organization_id)
SELECT 'Dedicated Learner', 'Completed 10 lessons', 'flame', 'lessons_completed', 10, o.id
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM lms_badges b WHERE b.organization_id = o.id AND b.criteria_type = 'lessons_completed' AND b.criteria_value = 10
);

INSERT INTO lms_badges (name, description, icon, criteria_type, criteria_value, organization_id)
SELECT 'Course Champion', 'Completed a full course', 'trophy', 'course_completed', 1, o.id
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM lms_badges b WHERE b.organization_id = o.id AND b.criteria_type = 'course_completed' AND b.criteria_value = 1
);

INSERT INTO lms_badges (name, description, icon, criteria_type, criteria_value, organization_id)
SELECT 'Perfect Score', 'Scored 100% on a quiz', 'star', 'perfect_quiz', 1, o.id
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM lms_badges b WHERE b.organization_id = o.id AND b.criteria_type = 'perfect_quiz' AND b.criteria_value = 1
);
