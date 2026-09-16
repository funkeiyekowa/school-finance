/**
 * Pure unit tests for student dashboard presentation logic.
 * Run: npx tsx src/lib/tests/student-dashboard.test.ts
 */
import {
  bucketExams,
  formatScore,
  formatPercentage,
  isActionable,
  nextUpExam,
} from "../exams/examState";
import type { DashboardExam, ExamState } from "../types/student-dashboard";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}\n       expected ${e}\n       actual   ${a}`);
  }
}

function exam(id: string, state: ExamState, over: Partial<DashboardExam> = {}): DashboardExam {
  return {
    id,
    title: `Exam ${id}`,
    exam_type: "exam",
    duration_minutes: 60,
    total_marks: 50,
    pass_mark: 25,
    max_attempts: 1,
    show_answers: true,
    starts_at: null,
    ends_at: null,
    attempts_used: 0,
    attempts_left: 1,
    in_progress_attempt_id: null,
    best_attempt: null,
    state,
    ...over,
  };
}

console.log("student dashboard helpers");

// The regression this suite exists for: marks must never render as a percentage.
check("formatScore marks + pct", formatScore(36, 50, 72), "36/50 · 72.0%");
check("formatScore derives pct", formatScore(25, 50, null), "25/50 · 50.0%");
check("formatScore zero score", formatScore(0, 50, 0), "0/50 · 0.0%");
check("formatScore no data", formatScore(null, null, null), "—");
check("formatScore no denominator", formatScore(7, 0, null), "7");
check("formatPercentage null", formatPercentage(null), "—");
check("formatPercentage value", formatPercentage(66.666), "66.7%");

check("isActionable available", isActionable(exam("a", "available")), true);
check("isActionable in_progress", isActionable(exam("b", "in_progress")), true);
check("isActionable exhausted", isActionable(exam("c", "exhausted")), false);
check("isActionable upcoming", isActionable(exam("d", "upcoming")), false);

const set = [
  exam("1", "exhausted"),
  exam("2", "available", { ends_at: "2030-01-02T00:00:00Z" }),
  exam("3", "available", { ends_at: "2030-01-01T00:00:00Z" }),
  exam("4", "upcoming", { starts_at: "2031-01-01T00:00:00Z" }),
  exam("5", "closed"),
];
const buckets = bucketExams(set);
check("bucket available", buckets.available.map(e => e.id), ["2", "3"]);
check("bucket upcoming", buckets.upcoming.map(e => e.id), ["4"]);
check("bucket completed includes closed", buckets.completed.map(e => e.id), ["1", "5"]);
check("bucket inProgress empty", buckets.inProgress.length, 0);

check("nextUp picks soonest deadline", nextUpExam(set)?.id, "3");
check(
  "nextUp prefers in_progress",
  nextUpExam([...set, exam("9", "in_progress")])?.id,
  "9",
);
check("nextUp upcoming only", nextUpExam([exam("4", "upcoming")])?.id, "4");
check("nextUp nothing", nextUpExam([exam("1", "exhausted")]), null);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
