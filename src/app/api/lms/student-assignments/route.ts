import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireActiveSession } from "@/lib/api/requireSession";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const session = await requireActiveSession();
  if (session instanceof Response) return session;
  if (session.role !== "student") return NextResponse.json({ error: "Student access required." }, { status: 403 });

  const lessonId = new URL(request.url).searchParams.get("lesson_id")?.trim() ?? "";
  if (!UUID.test(lessonId)) return NextResponse.json({ error: "A valid lesson_id is required." }, { status: 400 });
  const supabase = await createClient();

  const { data: student } = await supabase.from("students")
    .select("id").eq("profile_id", session.user.id)
    .eq("organization_id", session.organizationId).eq("status", "active").maybeSingle();
  if (!student) return NextResponse.json({ error: "No active student record is linked to this account." }, { status: 403 });

  const { data: lesson } = await supabase.from("lms_lessons")
    .select("id, course_id, status").eq("id", lessonId)
    .eq("organization_id", session.organizationId).maybeSingle();
  if (!lesson || lesson.status !== "published") return NextResponse.json({ error: "Lesson not found." }, { status: 404 });

  const { data: enrollment } = await supabase.from("lms_enrollments")
    .select("id").eq("course_id", lesson.course_id).eq("student_id", student.id)
    .eq("organization_id", session.organizationId).eq("status", "active").maybeSingle();
  if (!enrollment) return NextResponse.json({ error: "You are not enrolled in this course." }, { status: 403 });

  const { data: assignmentData, error: assignmentError } = await supabase.from("lms_assignments")
    .select("id, title, instructions, max_score, due_date")
    .eq("lesson_id", lessonId).eq("organization_id", session.organizationId)
    .order("created_at");
  if (assignmentError) return NextResponse.json({ error: "Assignments could not be loaded." }, { status: 500 });
  const assignments = assignmentData ?? [];
  if (!assignments.length) return NextResponse.json({ assignments: [] });

  const assignmentIds = assignments.map((assignment) => assignment.id);
  const [{ data: submissionData }, { data: rubricData }] = await Promise.all([
    supabase.from("lms_submissions")
      .select("id, assignment_id, response_text, status, score, feedback, submitted_at, graded_at")
      .eq("student_id", student.id).eq("organization_id", session.organizationId).in("assignment_id", assignmentIds),
    supabase.from("lms_rubrics")
      .select("id, assignment_id, title, description, total_points")
      .eq("organization_id", session.organizationId).in("assignment_id", assignmentIds),
  ]);
  const submissions = submissionData ?? [];
  const rubrics = rubricData ?? [];
  const rubricIds = rubrics.map((rubric) => rubric.id);
  const { data: criteriaData } = rubricIds.length
    ? await supabase.from("lms_rubric_criteria")
        .select("id, rubric_id, title, description, max_points, sort_order")
        .eq("organization_id", session.organizationId).in("rubric_id", rubricIds).order("sort_order")
    : { data: [] };

  return NextResponse.json({
    assignments: assignments.map((assignment) => {
      const submission = submissions.find((row) => row.assignment_id === assignment.id) ?? null;
      const rubric = rubrics.find((row) => row.assignment_id === assignment.id) ?? null;
      return {
        id: assignment.id,
        title: assignment.title,
        instructions: assignment.instructions,
        maxScore: Number(assignment.max_score),
        dueDate: assignment.due_date,
        submission,
        rubric: rubric ? {
          id: rubric.id,
          title: rubric.title,
          description: rubric.description,
          totalPoints: Number(rubric.total_points),
          criteria: (criteriaData ?? []).filter((criterion) => criterion.rubric_id === rubric.id).map((criterion) => ({
            id: criterion.id,
            title: criterion.title,
            description: criterion.description,
            maxPoints: Number(criterion.max_points),
          })),
        } : null,
      };
    }),
  });
}

export async function POST(request: Request) {
  const session = await requireActiveSession();
  if (session instanceof Response) return session;
  if (session.role !== "student") return NextResponse.json({ error: "Student access required." }, { status: 403 });

  let body: { assignmentId?: string; responseText?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 }); }
  if (!body.assignmentId || !UUID.test(body.assignmentId)) return NextResponse.json({ error: "A valid assignmentId is required." }, { status: 400 });
  const responseText = body.responseText?.trim() ?? "";
  if (!responseText) return NextResponse.json({ error: "A response is required." }, { status: 400 });
  if (responseText.length > 20_000) return NextResponse.json({ error: "Response must be 20,000 characters or fewer." }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("phase2_submit_lms_assignment", {
    p_assignment_id: body.assignmentId,
    p_response_text: responseText,
  });
  if (error) return NextResponse.json({ error: error.message || "Assignment could not be submitted." }, { status: 400 });
  return NextResponse.json({ ok: true, submission: Array.isArray(data) ? data[0] : data });
}
