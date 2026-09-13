export interface ExamRow {
  id: string;
  title: string;
  exam_type: string | null;
  duration_minutes: number | null;
  total_marks: number | null;
  pass_mark: number | null;
  class_id: string | null;
  status: string;
  max_attempts: number | null;
  show_answers: boolean | null;
  starts_at: string | null;
  ends_at: string | null;
  settings: Record<string, unknown> | null;
}

export interface AttemptRow {
  id: string;
  exam_id: string;
  attempt_number: number | null;
  total_score: number | null;
  total_marks: number | null;
  percentage: number | null;
  passed: boolean | null;
  status: string;
  submitted_at: string | null;
  started_at: string;
}

export interface AssignmentRow {
  id: string;
  exam_id: string;
  available_from: string | null;
  available_to: string | null;
}

export interface QuestionRow {
  id: string;
  question_text: string;
  question_type: string;
  options: OptionRow[];
  marks: number;
  sort_order: number | null;
}

export interface OptionRow {
  id: string;
  text: string;
}

/** Local answer state for one question. */
export interface AnswerValue {
  selected?: string[];
  text?: string;
}

export interface StartAttemptResult {
  ok?: boolean;
  completed?: boolean;
  reason?: string;
  attempt_id?: string;
  starts_at?: string;
  ends_at?: string;
  violation_count?: number;
  show_results?: boolean;
  completion_message?: string;
  total_score?: number | null;
  total_marks?: number | null;
  percentage?: number | null;
  passed?: boolean | null;
}

export interface ViolationResult {
  ok?: boolean;
  action?: "warn" | "terminate";
  strike?: number;
  remaining?: number;
  max_violations?: number;
}

export interface SubmitResult {
  ok?: boolean;
  total_score?: number;
  total_marks?: number;
  percentage?: number;
  passed?: boolean | null;
}

/**
 * Question types the mobile client can render faithfully.
 *
 * An exam containing anything outside this set is blocked on mobile rather
 * than partially rendered — a student who cannot answer a matching or ordering
 * question on their phone would silently score zero on it. They are told to
 * use a computer instead.
 */
export const SUPPORTED_QUESTION_TYPES = new Set([
  "multiple_choice",
  "single_choice",
  "true_false",
  "multi_answer",
  "short_answer",
  "essay",
  "fill_blank",
]);

export const TEXT_QUESTION_TYPES = new Set(["short_answer", "essay", "fill_blank"]);

export function isMultiSelect(questionType: string): boolean {
  return questionType === "multi_answer";
}

export function isTextAnswer(questionType: string): boolean {
  return TEXT_QUESTION_TYPES.has(questionType);
}

export function unsupportedTypes(questions: QuestionRow[]): string[] {
  const bad = new Set<string>();
  for (const q of questions) {
    if (!SUPPORTED_QUESTION_TYPES.has(q.question_type)) bad.add(q.question_type);
  }
  return [...bad];
}

/**
 * Proctoring knobs live in exams.settings (jsonb), same as web.
 * `proctored` exams are refused on mobile — see exam-service.
 */
export interface ProctorSettings {
  proctored: boolean;
  maxViolations: number;
}

export function readProctorSettings(settings: Record<string, unknown> | null): ProctorSettings {
  const s = settings ?? {};
  const max = s.max_violations;
  return {
    proctored: s.proctored === true,
    maxViolations: typeof max === "number" && max > 0 ? max : 3,
  };
}
