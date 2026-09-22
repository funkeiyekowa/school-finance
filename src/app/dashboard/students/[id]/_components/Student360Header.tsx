"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  CalendarCheck,
  CircleDollarSign,
  FileBarChart,
  GraduationCap,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Student360Summary {
  generatedAt: string;
  partial: boolean;
  unavailableSections: string[];
  student: {
    id: string;
    student_code: string;
    full_name: string;
    grade: string | null;
    academic_year: string | null;
    status: string;
    photo_url: string | null;
  };
  attendance: {
    lookbackDays: number;
    recordedSessions: number;
    presentSessions: number;
    absentSessions: number;
    attendanceRate: number | null;
    latestRecordDate: string | null;
  };
  academics: {
    scoreCount: number;
    average: number | null;
    subjectPerformance: Array<{
      subjectId: string;
      subjectName: string;
      average: number;
      scoreCount: number;
    }>;
    recentReportCards: Array<{
      id: string;
      term: string;
      average: number;
      grade: string | null;
      published: boolean;
      createdAt: string;
    }>;
  };
  links: {
    attendance: string;
    assessments: string;
    reportCards: string;
    finance: string;
  };
}

function formatPercent(value: number | null) {
  return value == null ? "No data" : `${value.toFixed(1)}%`;
}

function toneForPercent(value: number | null) {
  if (value == null) return "text-gray-500";
  if (value >= 80) return "text-emerald-700";
  if (value >= 60) return "text-amber-700";
  return "text-red-700";
}

export function Student360Header({ studentId }: { studentId: string }) {
  const pathname = usePathname();
  const expectedPath = `/dashboard/students/${studentId}`;
  const shouldRender = pathname.replace(/\/$/, "") === expectedPath;
  const [summary, setSummary] = useState<Student360Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!shouldRender) return;
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/students/360?student_id=${encodeURIComponent(studentId)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => ({}))) as Student360Summary & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Student summary could not be loaded.");
        setSummary(payload);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "Student summary could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [reloadKey, shouldRender, studentId]);

  const latestReport = summary?.academics.recentReportCards[0] ?? null;
  const strongestSubjects = useMemo(
    () => summary?.academics.subjectPerformance.slice(0, 3) ?? [],
    [summary],
  );

  if (!shouldRender) return null;

  if (loading) {
    return (
      <section className="px-6 pt-6" aria-label="Loading Student 360 overview">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm animate-pulse">
          <div className="h-28 bg-gradient-to-r from-slate-100 via-slate-50 to-amber-50" />
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((item) => <div key={item} className="h-24 rounded-xl bg-slate-100" />)}
          </div>
        </div>
      </section>
    );
  }

  if (error || !summary) {
    return (
      <section className="px-6 pt-6">
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="text-red-600" size={20} />
            <div>
              <p className="text-sm font-semibold text-red-900">Student 360 overview is temporarily unavailable</p>
              <p className="text-xs text-red-700">{error}</p>
            </div>
          </div>
          <button onClick={() => setReloadKey((key) => key + 1)} className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-semibold text-red-800 hover:bg-red-100">
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="px-6 pt-6" aria-labelledby="student-360-title">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="relative bg-gradient-to-r from-[#0F2A47] via-[#163b63] to-[#24527d] px-5 py-5 text-white">
          <div className="absolute inset-y-0 right-0 w-1/3 bg-[radial-gradient(circle_at_center,rgba(201,162,39,0.25),transparent_65%)]" />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/20 bg-white/10 text-xl font-bold text-[#f4d66e]">
                {summary.student.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={summary.student.photo_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  summary.student.full_name.charAt(0).toUpperCase() || <UserRound size={24} />
                )}
              </div>
              <div>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#C9A227]/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[#f4d66e]">
                    <Sparkles size={10} /> Student 360
                  </span>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/80">
                    {summary.student.status}
                  </span>
                </div>
                <h2 id="student-360-title" className="text-xl font-bold">{summary.student.full_name}</h2>
                <p className="mt-0.5 text-xs text-slate-200">
                  {summary.student.student_code}
                  {summary.student.grade ? ` · ${summary.student.grade}` : ""}
                  {summary.student.academic_year ? ` · ${summary.student.academic_year}` : ""}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-slate-200">
              <ShieldCheck size={14} className="text-emerald-300" />
              Role-aware, field-minimized summary
            </div>
          </div>
        </div>

        {summary.partial && (
          <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-5 py-2.5 text-xs text-amber-900">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            Some sections could not be refreshed: {summary.unavailableSections.join(", ")}. Existing student records below remain available.
          </div>
        )}

        <nav className="flex gap-1 overflow-x-auto border-b border-slate-100 px-4 py-2" aria-label="Student record sections">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-[#0F2A47] px-3 py-2 text-xs font-semibold text-white">
            <UserRound size={13} /> Overview
          </span>
          <Link href={summary.links.attendance} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-[#0F2A47]">
            <CalendarCheck size={13} /> Attendance
          </Link>
          <Link href={summary.links.assessments} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-[#0F2A47]">
            <GraduationCap size={13} /> Academics
          </Link>
          <Link href={summary.links.finance} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-[#0F2A47]">
            <CircleDollarSign size={13} /> Finance
          </Link>
          <Link href={summary.links.reportCards} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-[#0F2A47]">
            <FileBarChart size={13} /> Reports
          </Link>
        </nav>

        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            icon={<CalendarCheck size={18} />}
            label={`Attendance · ${summary.attendance.lookbackDays} days`}
            value={formatPercent(summary.attendance.attendanceRate)}
            valueClass={toneForPercent(summary.attendance.attendanceRate)}
            detail={summary.attendance.recordedSessions
              ? `${summary.attendance.presentSessions} present · ${summary.attendance.absentSessions} absent`
              : "No attendance sessions recorded"}
            href={summary.links.attendance}
          />
          <SummaryCard
            icon={<BarChart3 size={18} />}
            label="Academic average"
            value={formatPercent(summary.academics.average)}
            valueClass={toneForPercent(summary.academics.average)}
            detail={summary.academics.scoreCount
              ? `${summary.academics.scoreCount} normalized score${summary.academics.scoreCount === 1 ? "" : "s"}`
              : "No assessment scores recorded"}
            href={summary.links.assessments}
          />
          <SummaryCard
            icon={<FileBarChart size={18} />}
            label="Latest report"
            value={latestReport ? `${latestReport.average.toFixed(1)}%` : "No report"}
            valueClass={toneForPercent(latestReport?.average ?? null)}
            detail={latestReport
              ? `${latestReport.term}${latestReport.grade ? ` · Grade ${latestReport.grade}` : ""}${latestReport.published ? " · Published" : " · Draft"}`
              : "Generate a report card when results are ready"}
            href={summary.links.reportCards}
          />
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-500">
              <GraduationCap size={18} className="text-[#C9A227]" /> Strongest subjects
            </div>
            {strongestSubjects.length ? (
              <div className="space-y-2">
                {strongestSubjects.map((subject) => (
                  <div key={subject.subjectId} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-medium text-slate-700">{subject.subjectName}</span>
                    <span className={cn("font-bold", toneForPercent(subject.average))}>{subject.average.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500">Subject insights appear after scores are recorded.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  valueClass,
  detail,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueClass: string;
  detail: string;
  href: string;
}) {
  return (
    <Link href={href} className="group rounded-xl border border-slate-200 bg-white p-4 transition hover:-translate-y-0.5 hover:border-[#C9A227]/60 hover:shadow-md">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-2 text-xs font-semibold text-slate-500">{icon}{label}</span>
        <ArrowRight size={13} className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[#C9A227]" />
      </div>
      <div className={cn("text-2xl font-bold", valueClass)}>{value}</div>
      <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">{detail}</p>
    </Link>
  );
}
