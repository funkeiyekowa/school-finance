import { NextResponse } from "next/server";
import { requireStaffSessionWithOrg } from "@/lib/api/requireStaff";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const QUEUE_LIMIT = 200;

interface SubmissionRow {
  id: string;
  assignment_id: string;
  student_id: string;
  response_text: string | null;
  status: string;
  score: number | null;
  feedback: string | null;
  ai_suggested_score: number | null;
  submitted_at: string;
  graded_at: string | null;
}

interface AssignmentRow { id: string; lesson_id: string; title: string; max_score: number; due_date: string | null; }
interface LessonRow { id: string; course_id: string; title: string; }
interface CourseRow { id: string; title: string; }
interface StudentRow { id: string; full_name: string; student_code: string; grade: string | null; }

export async function GET() {
  const { guard, organizationId } = await requireStaffSessionWithOrg();
  if (guard) return guard;

  const supabase = await createClient();
  const { data: submissionsData, error: submissionsError } = await supabase
    .from("lms_submissions")
    .select("id, assignment_id, student_id, response_text, status, score, feedback, ai_suggested_score, submitted_at, graded_at")
    .eq("organization_id", organizationId)
    .order("submitted_at", { ascending: false })
    .limit(QUEUE_LIMIT);

  if (submissionsError) {
    return NextResponse.json({ error: "Could not load the grading queue." }, { status: 500 });
  }

  const submissions = (submissionsData ?? []) as SubmissionRow[];
  if (!submissions.length) {
    return NextResponse.json({ generatedAt: new Date().toISOString(), counts: { total: 0, pending: 0, graded: 0, overdue: 0 }, items: [] });
  }

  const assignmentIds = [...new Set(submissions.map((row) => row.assignment_id))];
  const studentIds = [...new Set(submissions.map((row) => row.student_id))];
  const [{ data: assignmentData, error: assignmentError }, { data: studentData, error: studentError }] = await Promise.all([
    supabase.from("lms_assignments").select("id, lesson_id, title, max_score, due_date").eq("organization_id", organizationId).in("id", assignmentIds),
    supabase.from("students").select("id, full_name, student_code, grade").eq("organization_id", organizationId).in("id", studentIds),
  ]);

  if (assignmentError || studentError) {
    return NextResponse.json({ error: "Could not resolve grading queue details." }, { status: 500 });
  }

  const assignments = (assignmentData ?? []) as AssignmentRow[];
  const lessonIds = [...new Set(assignments.map((row) => row.lesson_id))];
  const { data: lessonData, error: lessonError } = lessonIds.length
    ? await supabase.from("lms_lessons").select("id, course_id, title").eq("organization_id", organizationId).in("id", lessonIds)
    : { data: [], error: null };
  if (lessonError) return NextResponse.json({ error: "Could not resolve lesson details." }, { status: 500 });

  const lessons = (lessonData ?? []) as LessonRow[];
  const courseIds = [...new Set(lessons.map((row) => row.course_id))];
  const { data: courseData, error: courseError } = courseIds.length
    ? await supabase.from("lms_courses").select("id, title").eq("organization_id", organizationId).in("id", courseIds)
    : { data: [], error: null };
  if (courseError) return NextResponse.json({ error: "Could not resolve course details." }, { status: 500 });

  const assignmentById = new Map(assignments.map((row) => [row.id, row]));
  const lessonById = new Map(lessons.map((row) => [row.id, row]));
  const courseById = new Map(((courseData ?? []) as CourseRow[]).map((row) => [row.id, row]));
  const studentById = new Map(((studentData ?? []) as StudentRow[]).map((row) => [row.id, row]));
  const today = new Date().toISOString().slice(0, 10);

  const items = submissions.flatMap((submission) => {
    const assignment = assignmentById.get(submission.assignment_id);
    const student = studentById.get(submission.student_id);
    if (!assignment || !student) return [];
    const lesson = lessonById.get(assignment.lesson_id);
    const course = lesson ? courseById.get(lesson.course_id) : undefined;
    return [{
      ...submission,
      assignment: { id: assignment.id, title: assignment.title, maxScore: Number(assignment.max_score), dueDate: assignment.due_date },
      lesson: lesson ? { id: lesson.id, title: lesson.title } : null,
      course: course ? { id: course.id, title: course.title } : null,
      student,
      overdue: submission.status !== "graded" && !!assignment.due_date && assignment.due_date < today,
    }];
  });

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    counts: {
      total: items.length,
      pending: items.filter((item) => item.status !== "graded").length,
      graded: items.filter((item) => item.status === "graded").length,
      overdue: items.filter((item) => item.overdue).length,
    },
    items,
  });
}

export async function POST(request: Request) {
  const { guard } = await requireStaffSessionWithOrg();
  if (guard) return guard;

  let body: { submissionId?: string; score?: number; feedback?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  if (!body.submissionId || !UUID.test(body.submissionId) || typeof body.score !== "number" || !Number.isFinite(body.score)) {
    return NextResponse.json({ error: "A valid submissionId and numeric score are required." }, { status: 400 });
  }
  if (body.feedback && body.feedback.length > 5000) {
    return NextResponse.json({ error: "Feedback must be 5,000 characters or fewer." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("phase2_grade_lms_submission", {
    p_submission_id: body.submissionId,
    p_score: body.score,
    p_feedback: body.feedback?.trim() || null,
  });

  if (error) {
    return NextResponse.json({ error: error.message || "The grade could not be saved." }, { status: 400 });
  }
  const result = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ ok: true, submission: result });
}
