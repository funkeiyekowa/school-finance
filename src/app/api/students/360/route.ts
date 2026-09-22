import { NextResponse } from "next/server";
import { requireStaffSessionWithOrg } from "@/lib/api/requireStaff";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ATTENDANCE_LOOKBACK_DAYS = 120;
const SCORE_LIMIT = 250;

interface AttendanceRow {
  date: string;
  status_code: string;
}

interface AttendanceStatusRow {
  code: string;
  counts_as_present: boolean;
}

interface ScoreRow {
  score: number | null;
  subject_id: string;
  assessment_type_id: string;
  term: string | null;
  created_at: string;
}

interface AssessmentTypeRow {
  id: string;
  max_score: number;
}

interface SubjectRow {
  id: string;
  name: string;
}

interface ReportCardRow {
  id: string;
  term: string;
  average_score: number;
  grade_overall: string | null;
  published: boolean;
  created_at: string;
}

function round(value: number, places = 1) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * Field-minimized, tenant-scoped summary contract for Student 360.
 *
 * This deliberately omits DOB, address, guardian contact details, free-text
 * notes, medical data and safeguarding data. Those domains need their own
 * permission-specific contracts rather than one broad client query.
 */
export async function GET(request: Request) {
  const { guard, organizationId } = await requireStaffSessionWithOrg({ permission: "students" });
  if (guard) return guard;

  const studentId = new URL(request.url).searchParams.get("student_id")?.trim() ?? "";
  if (!UUID.test(studentId)) {
    return NextResponse.json({ error: "A valid student_id is required." }, { status: 400 });
  }

  const supabase = await createClient();
  const lookback = new Date();
  lookback.setUTCDate(lookback.getUTCDate() - ATTENDANCE_LOOKBACK_DAYS);
  const lookbackDate = lookback.toISOString().slice(0, 10);

  const studentQuery = supabase
    .from("students")
    .select("id, student_code, full_name, grade, academic_year, status, photo_url")
    .eq("id", studentId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  const attendanceQuery = supabase
    .from("attendance_records")
    .select("date, status_code")
    .eq("student_id", studentId)
    .eq("organization_id", organizationId)
    .gte("date", lookbackDate)
    .order("date", { ascending: false });

  const attendanceStatusesQuery = supabase
    .from("attendance_statuses")
    .select("code, counts_as_present")
    .eq("organization_id", organizationId)
    .eq("active", true);

  const scoresQuery = supabase
    .from("student_scores")
    .select("score, subject_id, assessment_type_id, term, created_at")
    .eq("student_id", studentId)
    .eq("organization_id", organizationId)
    .not("score", "is", null)
    .order("created_at", { ascending: false })
    .limit(SCORE_LIMIT);

  const assessmentTypesQuery = supabase
    .from("assessment_types")
    .select("id, max_score")
    .eq("organization_id", organizationId)
    .eq("active", true);

  const subjectsQuery = supabase
    .from("subjects")
    .select("id, name")
    .eq("organization_id", organizationId)
    .eq("active", true);

  const reportCardsQuery = supabase
    .from("report_cards")
    .select("id, term, average_score, grade_overall, published, created_at")
    .eq("student_id", studentId)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(5);

  const [studentRes, attendanceRes, statusesRes, scoresRes, typesRes, subjectsRes, reportCardsRes] =
    await Promise.all([
      studentQuery,
      attendanceQuery,
      attendanceStatusesQuery,
      scoresQuery,
      assessmentTypesQuery,
      subjectsQuery,
      reportCardsQuery,
    ]);

  if (studentRes.error) {
    return NextResponse.json({ error: "Could not load the student record." }, { status: 500 });
  }
  if (!studentRes.data) {
    return NextResponse.json({ error: "Student not found." }, { status: 404 });
  }

  const partialErrors: string[] = [];
  if (attendanceRes.error || statusesRes.error) partialErrors.push("attendance");
  if (scoresRes.error || typesRes.error || subjectsRes.error) partialErrors.push("academics");
  if (reportCardsRes.error) partialErrors.push("report_cards");

  const attendanceRows = (attendanceRes.data ?? []) as AttendanceRow[];
  const attendanceStatuses = (statusesRes.data ?? []) as AttendanceStatusRow[];
  const presentCodes = new Set(
    attendanceStatuses.filter((status) => status.counts_as_present).map((status) => status.code),
  );
  const present = attendanceRows.filter((row) => presentCodes.has(row.status_code)).length;
  const attendanceRate = attendanceRows.length ? round((present / attendanceRows.length) * 100) : null;

  const assessmentTypes = new Map(
    ((typesRes.data ?? []) as AssessmentTypeRow[]).map((type) => [type.id, Number(type.max_score)]),
  );
  const subjects = new Map(
    ((subjectsRes.data ?? []) as SubjectRow[]).map((subject) => [subject.id, subject.name]),
  );
  const normalizedScores = ((scoresRes.data ?? []) as ScoreRow[]).flatMap((score) => {
    const maxScore = assessmentTypes.get(score.assessment_type_id) ?? 0;
    if (score.score == null || maxScore <= 0) return [];
    return [{
      subjectId: score.subject_id,
      subjectName: subjects.get(score.subject_id) ?? "Subject",
      percentage: (Number(score.score) / maxScore) * 100,
    }];
  });
  const academicAverage = normalizedScores.length
    ? round(normalizedScores.reduce((sum, score) => sum + score.percentage, 0) / normalizedScores.length)
    : null;

  const subjectBuckets = new Map<string, { name: string; values: number[] }>();
  for (const score of normalizedScores) {
    const bucket = subjectBuckets.get(score.subjectId) ?? { name: score.subjectName, values: [] };
    bucket.values.push(score.percentage);
    subjectBuckets.set(score.subjectId, bucket);
  }
  const subjectPerformance = [...subjectBuckets.entries()]
    .map(([subjectId, bucket]) => ({
      subjectId,
      subjectName: bucket.name,
      average: round(bucket.values.reduce((sum, value) => sum + value, 0) / bucket.values.length),
      scoreCount: bucket.values.length,
    }))
    .sort((a, b) => b.average - a.average)
    .slice(0, 8);

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    partial: partialErrors.length > 0,
    unavailableSections: partialErrors,
    student: studentRes.data,
    attendance: {
      lookbackDays: ATTENDANCE_LOOKBACK_DAYS,
      recordedSessions: attendanceRows.length,
      presentSessions: present,
      absentSessions: attendanceRows.length - present,
      attendanceRate,
      latestRecordDate: attendanceRows[0]?.date ?? null,
    },
    academics: {
      scoreCount: normalizedScores.length,
      average: academicAverage,
      subjectPerformance,
      recentReportCards: ((reportCardsRes.data ?? []) as ReportCardRow[]).map((card) => ({
        id: card.id,
        term: card.term,
        average: round(Number(card.average_score)),
        grade: card.grade_overall,
        published: card.published,
        createdAt: card.created_at,
      })),
    },
    links: {
      attendance: `/dashboard/attendance/student?student=${studentId}`,
      assessments: "/dashboard/assessments",
      reportCards: "/dashboard/report-cards",
      finance: `/dashboard/student-finance?student=${studentId}`,
    },
  });
}
