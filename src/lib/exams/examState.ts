import type { DashboardExam, ExamState } from "@/lib/types/student-dashboard";

export const EXAM_STATE_LABEL: Record<ExamState, string> = {
  in_progress: "Resume",
  available: "Start",
  upcoming: "Not yet open",
  closed: "Closed",
  exhausted: "Completed",
};

export const EXAM_STATE_BADGE: Record<ExamState, string> = {
  in_progress: "bg-amber-100 text-amber-800",
  available: "bg-green-100 text-green-800",
  upcoming: "bg-gray-100 text-gray-600",
  closed: "bg-gray-100 text-gray-500",
  exhausted: "bg-blue-100 text-blue-800",
};

export function isActionable(exam: DashboardExam): boolean {
  return exam.state === "available" || exam.state === "in_progress";
}

/** "36/50 · 72%" — never a bare number, never marks rendered as a percentage. */
export function formatScore(
  score: number | null | undefined,
  totalMarks: number | null | undefined,
  percentage: number | null | undefined,
): string {
  const hasScore = score !== null && score !== undefined;
  const hasTotal = !!totalMarks && totalMarks > 0;
  const pct =
    percentage !== null && percentage !== undefined
      ? percentage
      : hasScore && hasTotal
        ? (Number(score) / Number(totalMarks)) * 100
        : null;

  if (!hasScore && pct === null) return "—";
  const left = hasScore ? (hasTotal ? `${score}/${totalMarks}` : `${score}`) : "";
  const right = pct === null ? "" : `${Number(pct).toFixed(1)}%`;
  return [left, right].filter(Boolean).join(" · ");
}

export function formatPercentage(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${Number(value).toFixed(1)}%`;
}

export interface ExamBuckets {
  inProgress: DashboardExam[];
  available: DashboardExam[];
  upcoming: DashboardExam[];
  completed: DashboardExam[];
}

export function bucketExams(exams: DashboardExam[]): ExamBuckets {
  return {
    inProgress: exams.filter(e => e.state === "in_progress"),
    available: exams.filter(e => e.state === "available"),
    upcoming: exams.filter(e => e.state === "upcoming"),
    completed: exams.filter(e => e.state === "exhausted" || e.state === "closed"),
  };
}

/** The single thing the student should do next, or null. */
export function nextUpExam(exams: DashboardExam[]): DashboardExam | null {
  const buckets = bucketExams(exams);
  if (buckets.inProgress.length > 0) return buckets.inProgress[0];
  if (buckets.available.length > 0) {
    return [...buckets.available].sort((a, b) => {
      const ae = a.ends_at ? Date.parse(a.ends_at) : Number.MAX_SAFE_INTEGER;
      const be = b.ends_at ? Date.parse(b.ends_at) : Number.MAX_SAFE_INTEGER;
      return ae - be;
    })[0];
  }
  if (buckets.upcoming.length > 0) {
    return [...buckets.upcoming].sort((a, b) => {
      const as = a.starts_at ? Date.parse(a.starts_at) : Number.MAX_SAFE_INTEGER;
      const bs = b.starts_at ? Date.parse(b.starts_at) : Number.MAX_SAFE_INTEGER;
      return as - bs;
    })[0];
  }
  return null;
}
