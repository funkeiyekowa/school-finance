import { NextResponse } from "next/server";
import { requireStaffSessionWithOrg } from "@/lib/api/requireStaff";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CRITERIA = 20;

interface AssignmentRow { id: string; lesson_id: string; title: string; max_score: number; due_date: string | null; }
interface LessonRow { id: string; course_id: string; title: string; }
interface CourseRow { id: string; title: string; }
interface RubricRow { id: string; assignment_id: string; title: string; description: string | null; total_points: number; updated_at: string; }
interface CriterionRow { id: string; rubric_id: string; title: string; description: string | null; max_points: number; sort_order: number; }

export async function GET() {
  const { guard, organizationId } = await requireStaffSessionWithOrg();
  if (guard) return guard;
  const supabase = await createClient();

  const { data: assignmentData, error: assignmentError } = await supabase
    .from("lms_assignments")
    .select("id, lesson_id, title, max_score, due_date")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(250);
  if (assignmentError) return NextResponse.json({ error: "Could not load authorized assignments." }, { status: 500 });

  const assignments = (assignmentData ?? []) as AssignmentRow[];
  if (!assignments.length) return NextResponse.json({ assignments: [] });

  const lessonIds = [...new Set(assignments.map((row) => row.lesson_id))];
  const assignmentIds = assignments.map((row) => row.id);
  const [{ data: lessonData, error: lessonError }, { data: rubricData, error: rubricError }] = await Promise.all([
    supabase.from("lms_lessons").select("id, course_id, title").eq("organization_id", organizationId).in("id", lessonIds),
    supabase.from("lms_rubrics").select("id, assignment_id, title, description, total_points, updated_at").eq("organization_id", organizationId).in("assignment_id", assignmentIds),
  ]);
  if (lessonError || rubricError) return NextResponse.json({ error: "Could not resolve rubric workspace details." }, { status: 500 });

  const lessons = (lessonData ?? []) as LessonRow[];
  const rubrics = (rubricData ?? []) as RubricRow[];
  const courseIds = [...new Set(lessons.map((row) => row.course_id))];
  const rubricIds = rubrics.map((row) => row.id);
  const [{ data: courseData, error: courseError }, criteriaResult] = await Promise.all([
    courseIds.length
      ? supabase.from("lms_courses").select("id, title").eq("organization_id", organizationId).in("id", courseIds)
      : Promise.resolve({ data: [], error: null }),
    rubricIds.length
      ? supabase.from("lms_rubric_criteria").select("id, rubric_id, title, description, max_points, sort_order").eq("organization_id", organizationId).in("rubric_id", rubricIds).order("sort_order")
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (courseError || criteriaResult.error) return NextResponse.json({ error: "Could not load rubric criteria." }, { status: 500 });

  const criteria = (criteriaResult.data ?? []) as CriterionRow[];
  const criterionIds = criteria.map((row) => row.id);
  const { data: scoredData, error: scoredError } = criterionIds.length
    ? await supabase.from("lms_rubric_scores").select("criterion_id").eq("organization_id", organizationId).in("criterion_id", criterionIds).limit(1_000)
    : { data: [], error: null };
  if (scoredError) return NextResponse.json({ error: "Could not determine rubric edit status." }, { status: 500 });

  const scoredCriteria = new Set(((scoredData ?? []) as Array<{ criterion_id: string }>).map((row) => row.criterion_id));
  const lessonById = new Map(lessons.map((row) => [row.id, row]));
  const courseById = new Map(((courseData ?? []) as CourseRow[]).map((row) => [row.id, row]));
  const rubricByAssignment = new Map(rubrics.map((row) => [row.assignment_id, row]));

  return NextResponse.json({
    assignments: assignments.map((assignment) => {
      const lesson = lessonById.get(assignment.lesson_id);
      const course = lesson ? courseById.get(lesson.course_id) : null;
      const rubric = rubricByAssignment.get(assignment.id);
      const rubricCriteria = rubric ? criteria.filter((row) => row.rubric_id === rubric.id) : [];
      return {
        id: assignment.id,
        title: assignment.title,
        maxScore: Number(assignment.max_score),
        dueDate: assignment.due_date,
        lesson: lesson ? { id: lesson.id, title: lesson.title } : null,
        course: course ? { id: course.id, title: course.title } : null,
        rubric: rubric ? {
          id: rubric.id,
          title: rubric.title,
          description: rubric.description,
          totalPoints: Number(rubric.total_points),
          updatedAt: rubric.updated_at,
          locked: rubricCriteria.some((criterion) => scoredCriteria.has(criterion.id)),
          criteria: rubricCriteria.map((criterion) => ({
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
  const { guard } = await requireStaffSessionWithOrg();
  if (guard) return guard;

  let body: {
    assignmentId?: string;
    title?: string;
    description?: string;
    criteria?: Array<{ title?: string; description?: string; maxPoints?: number }>;
  };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 }); }

  if (!body.assignmentId || !UUID.test(body.assignmentId)) return NextResponse.json({ error: "A valid assignmentId is required." }, { status: 400 });
  if (!body.title?.trim() || body.title.length > 200) return NextResponse.json({ error: "Rubric title is required and must be 200 characters or fewer." }, { status: 400 });
  if (body.description && body.description.length > 2_000) return NextResponse.json({ error: "Rubric description must be 2,000 characters or fewer." }, { status: 400 });
  if (!Array.isArray(body.criteria) || body.criteria.length < 1 || body.criteria.length > MAX_CRITERIA) return NextResponse.json({ error: "A rubric requires 1 to 20 criteria." }, { status: 400 });

  const criteria = body.criteria.map((criterion) => ({
    title: criterion.title?.trim() || "",
    description: criterion.description?.trim() || "",
    max_points: Number(criterion.maxPoints),
  }));
  if (criteria.some((criterion) => !criterion.title || criterion.title.length > 200 || !Number.isFinite(criterion.max_points) || criterion.max_points <= 0)) {
    return NextResponse.json({ error: "Every criterion needs a title of at most 200 characters and positive maximum points." }, { status: 400 });
  }
  if (criteria.some((criterion) => criterion.description.length > 2_000)) return NextResponse.json({ error: "Criterion descriptions must be 2,000 characters or fewer." }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("phase2_save_assignment_rubric", {
    p_assignment_id: body.assignmentId,
    p_title: body.title.trim(),
    p_description: body.description?.trim() || null,
    p_criteria: criteria,
  });
  if (error) return NextResponse.json({ error: error.message || "Rubric could not be saved." }, { status: 400 });
  return NextResponse.json({ ok: true, rubricId: data });
}
