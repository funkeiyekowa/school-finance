-- ============================================================
-- CBT / ONLINE EXAMINATION SYSTEM
-- Run this in the Supabase SQL editor.
--
-- Creates:
--   1. questions — the question bank
--   2. exams — exam/quiz/test definitions
--   3. exam_questions — links questions to an exam (with ordering)
--   4. exam_attempts — one row per student per exam attempt
--   5. exam_answers — one row per question answered in an attempt
-- ============================================================

-- ==========================================================
-- 1. QUESTIONS — the reusable question bank
-- ==========================================================
CREATE TABLE IF NOT EXISTS questions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  subject_id uuid REFERENCES subjects(id) ON DELETE SET NULL,
  class_id uuid REFERENCES classes(id) ON DELETE SET NULL,
  topic text,
  subtopic text,
  question_text text NOT NULL,           -- The question body (supports markdown/HTML)
  question_type text NOT NULL DEFAULT 'multiple_choice',
    -- 'multiple_choice', 'true_false', 'multi_answer', 'short_answer', 'essay'
  options jsonb,                         -- Array of option objects: [{id, text, is_correct}]
  correct_answer text,                   -- For short_answer/true_false; for MCQ stored in options
  explanation text,                      -- Shown after answering
  difficulty text DEFAULT 'medium',      -- 'easy', 'medium', 'hard'
  marks numeric(5,2) NOT NULL DEFAULT 1, -- Points for this question
  tags text[],                           -- Arbitrary tags for filtering
  media_url text,                        -- Optional image/audio URL
  active boolean NOT NULL DEFAULT true,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_questions_subject ON questions(subject_id);
CREATE INDEX IF NOT EXISTS idx_questions_class ON questions(class_id);
CREATE INDEX IF NOT EXISTS idx_questions_org ON questions(organization_id);
CREATE INDEX IF NOT EXISTS idx_questions_difficulty ON questions(difficulty);
CREATE INDEX IF NOT EXISTS idx_questions_type ON questions(question_type);

-- ==========================================================
-- 2. EXAMS — exam/quiz/test definitions
-- ==========================================================
CREATE TABLE IF NOT EXISTS exams (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  title text NOT NULL,
  description text,
  exam_type text NOT NULL DEFAULT 'exam',  -- 'exam', 'quiz', 'test', 'assignment', 'practice'
  subject_id uuid REFERENCES subjects(id) ON DELETE SET NULL,
  class_id uuid REFERENCES classes(id) ON DELETE SET NULL,
  academic_year_id uuid REFERENCES academic_years(id) ON DELETE SET NULL,
  term text,
  duration_minutes integer NOT NULL DEFAULT 60,  -- Time limit
  total_marks numeric(6,2) NOT NULL DEFAULT 0,
  pass_mark numeric(6,2) DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 1,
  shuffle_questions boolean NOT NULL DEFAULT false,
  shuffle_options boolean NOT NULL DEFAULT false,
  show_results boolean NOT NULL DEFAULT true,     -- Show score after submission
  show_answers boolean NOT NULL DEFAULT false,    -- Show correct answers after submission
  starts_at timestamptz,                          -- When exam becomes available
  ends_at timestamptz,                            -- When exam closes
  status text NOT NULL DEFAULT 'draft',           -- 'draft', 'published', 'closed', 'archived'
  settings jsonb DEFAULT '{}',                    -- Additional configurable settings
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exams_org ON exams(organization_id);
CREATE INDEX IF NOT EXISTS idx_exams_class ON exams(class_id);
CREATE INDEX IF NOT EXISTS idx_exams_status ON exams(status);

-- ==========================================================
-- 3. EXAM_QUESTIONS — links questions to exams with order
-- ==========================================================
CREATE TABLE IF NOT EXISTS exam_questions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  exam_id uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  marks_override numeric(5,2),           -- Override the question's default marks for this exam
  UNIQUE(exam_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_exam_questions_exam ON exam_questions(exam_id);

-- ==========================================================
-- 4. EXAM ATTEMPTS — one per student per attempt
-- ==========================================================
CREATE TABLE IF NOT EXISTS exam_attempts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  exam_id uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL DEFAULT 1,
  started_at timestamptz DEFAULT now(),
  submitted_at timestamptz,
  time_spent_seconds integer,
  total_score numeric(6,2),
  total_marks numeric(6,2),
  percentage numeric(5,2),
  passed boolean,
  status text NOT NULL DEFAULT 'in_progress',  -- 'in_progress', 'submitted', 'graded', 'timed_out'
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(exam_id, student_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_attempts_exam ON exam_attempts(exam_id);
CREATE INDEX IF NOT EXISTS idx_attempts_student ON exam_attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_attempts_org ON exam_attempts(organization_id);

-- ==========================================================
-- 5. EXAM ANSWERS — one per question answered
-- ==========================================================
CREATE TABLE IF NOT EXISTS exam_answers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  attempt_id uuid NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  selected_option text,                  -- The option ID or text selected
  answer_text text,                      -- For short_answer/essay type
  is_correct boolean,                    -- null = not yet graded (essay)
  marks_awarded numeric(5,2),            -- Marks given (auto or manual)
  time_spent_seconds integer,
  flagged boolean NOT NULL DEFAULT false, -- Student flagged for review
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(attempt_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_answers_attempt ON exam_answers(attempt_id);

-- ==========================================================
-- 6. RLS POLICIES
-- ==========================================================
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_answers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='questions' AND policyname='questions_read') THEN
    CREATE POLICY "questions_read" ON questions FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='questions' AND policyname='questions_write') THEN
    CREATE POLICY "questions_write" ON questions FOR ALL USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='exams' AND policyname='exams_read') THEN
    CREATE POLICY "exams_read" ON exams FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='exams' AND policyname='exams_write') THEN
    CREATE POLICY "exams_write" ON exams FOR ALL USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='exam_questions' AND policyname='eq_read') THEN
    CREATE POLICY "eq_read" ON exam_questions FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='exam_questions' AND policyname='eq_write') THEN
    CREATE POLICY "eq_write" ON exam_questions FOR ALL USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='exam_attempts' AND policyname='attempts_read') THEN
    CREATE POLICY "attempts_read" ON exam_attempts FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='exam_attempts' AND policyname='attempts_write') THEN
    CREATE POLICY "attempts_write" ON exam_attempts FOR ALL USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='exam_answers' AND policyname='answers_read') THEN
    CREATE POLICY "answers_read" ON exam_answers FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='exam_answers' AND policyname='answers_write') THEN
    CREATE POLICY "answers_write" ON exam_answers FOR ALL USING (true);
  END IF;
END $$;
