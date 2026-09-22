import { NextResponse } from "next/server";
import { requireStaffSessionWithOrg } from "@/lib/api/requireStaff";
import { createClient } from "@/lib/supabase/server";

interface CourseRow { id: string; title: string; status: string; }
interface LessonRow { id: string; course_id: string; status: string; }
interface AssignmentRow { id: string; lesson_id: string; title: string; max_score: number; due_date: string | null; }
interface EnrollmentRow { course_id: string; student_id: string; status: string; }
interface SubmissionRow { assignment_id: string; student_id: string; status: string; score: number | null; submitted_at: string; }
interface StudentRow { id: string; full_name: string; student_code: string; grade: string | null; }

export async function GET() {
  const { guard, organizationId } = await requireStaffSessionWithOrg();
  if (guard) return guard;

  const supabase = await createClient();
  const { data: courseData, error: courseError } = await supabase
    .from("lms_courses")
    .select("id, title, status")
    .eq("organization_id", organizationId)
    .order("title")
    .limit(100);
  if (courseError) return NextResponse.json({ error: "Could not load authorized courses." }, { status: 500 });

  const courses = (courseData ?? []) as CourseRow[];
  if (!courses.length) return NextResponse.json({ generatedAt: new Date().toISOString(), courses: [], rows: [] });
  const courseIds = courses.map((course) => course.id);

  const [{ data: lessonData, error: lessonError }, { data: enrollmentData, error: enrollmentError }] = await Promise.all([
    supabase.from("lms_lessons").select("id, course_id, status").eq("organization_id", organizationId).in("course_id", courseIds).limit(500),
    supabase.from("lms_enrollments").select("course_id, student_id, status").eq("organization_id", organizationId).in("course_id", courseIds).eq("status", "active").limit(2000),
  ]);
  if (lessonError || enrollmentError) return NextResponse.json({ error: "Could not load gradebook structure." }, { status: 500 });

  const lessons = (lessonData ?? []) as LessonRow[];
  const enrollments = (enrollmentData ?? []) as EnrollmentRow[];
  const lessonIds = lessons.map((lesson) => lesson.id);
  const studentIds = [...new Set(enrollments.map((enrollment) => enrollment.student_id))];

  const [{ data: assignmentData, error: assignmentError }, { data: studentData, error: studentError }] = await Promise.all([
    lessonIds.length
      ? supabase.from("lms_assignments").select("id, lesson_id, title, max_score, due_date").eq("organization_id", organizationId).in("lesson_id", lessonIds).limit(1000)
      : Promise.resolve({ data: [], error: null }),
    studentIds.length
      ? supabase.from("students").select("id, full_name, student_code, grade").eq("organization_id", organizationId).in("id", studentIds).limit(2000)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (assignmentError || studentError) return NextResponse.json({ error: "Could not resolve assignments or students." }, { status: 500 });

  const assignments = (assignmentData ?? []) as AssignmentRow[];
  const assignmentIds = assignments.map((assignment) => assignment.id);
  const { data: submissionData, error: submissionError } = assignmentIds.length
    ? await supabase.from("lms_submissions").select("assignment_id, student_id, status, score, submitted_at").eq("organization_id", organizationId).in("assignment_id", assignmentIds).limit(5000)
    : { data: [], error: null };
  if (submissionError) return NextResponse.json({ error: "Could not load authoritative grades." }, { status: 500 });

  const submissions = (submissionData ?? []) as SubmissionRow[];
  const courseById = new Map(courses.map((course) => [course.id, course]));
  const courseForLesson = new Map(lessons.map((lesson) => [lesson.id, lesson.course_id]));
  const assignmentsByCourse = new Map<string, AssignmentRow[]>();
  for (const assignment of assignments) {
    const courseId = courseForLesson.get(assignment.lesson_id);
    if (courseId) assignmentsByCourse.set(courseId, [...(assignmentsByCourse.get(courseId) ?? []), assignment]);
  }
  const studentById = new Map(((studentData ?? []) as StudentRow[]).map((student) => [student.id, student]));
  const submissionByKey = new Map(submissions.map((submission) => [`${submission.assignment_id}:${submission.student_id}`, submission]));
  const today = new Date().toISOString().slice(0, 10);

  const rows = enrollments.flatMap((enrollment) => {
    const course = courseById.get(enrollment.course_id);
    const student = studentById.get(enrollment.student_id);
    if (!course || !student) return [];
    const courseAssignments = assignmentsByCourse.get(course.id) ?? [];
    let earned = 0;
    let possible = 0;
    let graded = 0;
    let pending = 0;
    let missing = 0;
    let late = 0;

    for (const assignment of courseAssignments) {
      const submission = submissionByKey.get(`${assignment.id}:${student.id}`);
      if (!submission) {
        if (assignment.due_date && assignment.due_date < today) missing += 1;
        continue;
      }
      if (assignment.due_date && submission.submitted_at.slice(0, 10) > assignment.due_date) late += 1;
      if (submission.status === "graded" && submission.score != null) {
        earned += Number(submission.score);
        possible += Number(assignment.max_score);
        graded += 1;
      } else {
        pending += 1;
      }
    }

    const average = possible > 0 ? Math.round((earned / possible) * 1000) / 10 : null;
    const needsIntervention = missing > 0 || (average != null && average < 50);
    return [{
      course: { id: course.id, title: course.title, status: course.status },
      student,
      assignmentCount: courseAssignments.length,
      gradedCount: graded,
      pendingCount: pending,
      missingCount: missing,
      lateCount: late,
      earnedPoints: Math.round(earned * 100) / 100,
      possiblePoints: Math.round(possible * 100) / 100,
      average,
      needsIntervention,
    }];
  });

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    courses: courses.map((course) => ({ id: course.id, title: course.title, status: course.status })),
    rows,
  });
}
