export type ExamState =
  | "in_progress"
  | "available"
  | "upcoming"
  | "closed"
  | "exhausted";

export interface StudentSummary {
  id: string;
  student_code: string;
  full_name: string;
  grade: string | null;
  status: string;
  must_change_password: boolean;
}

export interface AttemptSummary {
  id: string;
  attempt_number: number | null;
  total_score: number | null;
  percentage: number | null;
  passed: boolean | null;
  status: string;
  submitted_at: string | null;
  started_at: string | null;
}

export interface DashboardExam {
  id: string;
  title: string;
  exam_type: string;
  duration_minutes: number;
  total_marks: number;
  pass_mark: number;
  max_attempts: number;
  show_answers: boolean;
  starts_at: string | null;
  ends_at: string | null;
  attempts_used: number;
  attempts_left: number;
  in_progress_attempt_id: string | null;
  best_attempt: AttemptSummary | null;
  state: ExamState;
}

export interface DashboardReportCard {
  id: string;
  term: string;
  average_score: number | null;
  grade_overall: string | null;
}

export interface DashboardStats {
  available: number;
  in_progress: number;
  upcoming: number;
  completed: number;
  avg_percentage: number | null;
}

export interface StudentDashboard {
  found: boolean;
  student: StudentSummary | null;
  exams: DashboardExam[];
  report_cards: DashboardReportCard[];
  stats: DashboardStats;
}

export interface ResultsSubject {
  id: string;
  name: string;
  short_code: string;
  total: number;
  max_total: number;
  percentage: number | null;
  grade: string | null;
  breakdown: { assessment_type_id: string; score: number | null }[];
}

export interface ResultsAttempt {
  id: string;
  exam_id: string;
  exam_title: string;
  total_score: number | null;
  total_marks: number | null;
  percentage: number | null;
  passed: boolean | null;
  attempt_number: number | null;
  submitted_at: string | null;
  show_answers: boolean;
}

export interface StudentResults {
  found: boolean;
  assessment_types: { id: string; name: string; short_code: string; max_score: number }[];
  subjects: ResultsSubject[];
  attempts: ResultsAttempt[];
  attendance: { total: number; present: number; percentage: number | null } | null;
}
