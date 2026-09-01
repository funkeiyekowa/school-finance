"use client";

/**
 * Teacher/admin LMS home — course catalogue management.
 *
 * Lists every course in the org with quick stats, lets staff create a
 * course (AI-assisted title/description optional via the course
 * detail page), and links into each course's lesson/quiz/assignment
 * builder. Mirrors the Transport module's list+modal CRUD convention.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useToast } from "@/lib/hooks/useToast";
import { extractErrorMessage } from "@/lib/errors/extractErrorMessage";
import { cn } from "@/lib/utils";
import { PageHeader, LoadingSpinner, EmptyState, KpiCard } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { GraduationCap, Plus, BookOpen, Users, Layers, ChevronRight, Trophy } from "lucide-react";

interface CourseRow {
  id: string;
  title: string;
  description: string | null;
  subject_id: string | null;
  class_id: string | null;
  teacher_staff_id: string | null;
  cover_color: string;
  status: string;
  leaderboard_enabled: boolean;
  created_at: string;
}

interface Option { id: string; name: string; }

interface Stats {
  total_courses: number;
  published_courses: number;
  total_lessons: number;
  total_enrollments: number;
}

export default function LmsHomePage() {
  const { canEdit } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const { notify, ToastHost } = useToast();

  const [loading, setLoading] = useState(true);
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [subjects, setSubjects] = useState<Option[]>([]);
  const [classes, setClasses] = useState<Option[]>([]);
  const [staff, setStaff] = useState<Option[]>([]);
  const [stats, setStats] = useState<Stats>({ total_courses: 0, published_courses: 0, total_lessons: 0, total_enrollments: 0 });
  const [lessonCounts, setLessonCounts] = useState<Record<string, number>>({});
  const [enrollCounts, setEnrollCounts] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [cRes, subRes, clsRes, stfRes, statsRes, lessonRes, enrollRes] = await Promise.all([
      supabase.from("lms_courses").select("*").order("created_at", { ascending: false }),
      supabase.from("subjects").select("id, name").order("name"),
      supabase.from("classes").select("id, name").order("name"),
      supabase.from("staff_members").select("id, full_name").eq("status", "active").order("full_name"),
      supabase.rpc("lms_course_stats"),
      supabase.from("lms_lessons").select("course_id"),
      supabase.from("lms_enrollments").select("course_id").eq("status", "active"),
    ]);
    setCourses((cRes.data as CourseRow[]) ?? []);
    setSubjects((subRes.data as Option[]) ?? []);
    setClasses((clsRes.data as Option[]) ?? []);
    setStaff(((stfRes.data as { id: string; full_name: string }[]) ?? []).map((s) => ({ id: s.id, name: s.full_name })));
    if (statsRes.data && statsRes.data[0]) {
      const s = statsRes.data[0];
      setStats({
        total_courses: s.total_courses || 0,
        published_courses: s.published_courses || 0,
        total_lessons: s.total_lessons || 0,
        total_enrollments: s.total_enrollments || 0,
      });
    }
    const lc: Record<string, number> = {};
    for (const row of (lessonRes.data as { course_id: string }[]) ?? []) lc[row.course_id] = (lc[row.course_id] || 0) + 1;
    setLessonCounts(lc);
    const ec: Record<string, number> = {};
    for (const row of (enrollRes.data as { course_id: string }[]) ?? []) ec[row.course_id] = (ec[row.course_id] || 0) + 1;
    setEnrollCounts(ec);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const subjectById = useMemo(() => new Map(subjects.map((s) => [s.id, s.name])), [subjects]);
  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c.name])), [classes]);
  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s.name])), [staff]);

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const emptyForm = { title: "", description: "", subject_id: "", class_id: "", teacher_staff_id: "", cover_color: "#0F2A47", leaderboard_enabled: true };
  const [form, setForm] = useState(emptyForm);

  async function createCourse() {
    if (!form.title.trim()) { notify("Course title is required.", "error"); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from("lms_courses").insert({
        title: form.title.trim(),
        description: form.description.trim() || null,
        subject_id: form.subject_id || null,
        class_id: form.class_id || null,
        teacher_staff_id: form.teacher_staff_id || null,
        cover_color: form.cover_color,
        leaderboard_enabled: form.leaderboard_enabled,
        status: "draft",
      });
      if (error) throw error;
      notify("Course created.");
      setShowForm(false);
      setForm(emptyForm);
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Failed to create course."), "error");
    } finally {
      setSaving(false);
    }
  }

  const COLORS = ["#0F2A47", "#C9A227", "#7C3AED", "#059669", "#DC2626", "#0891B2"];

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="Learning Management"
        subtitle="Courses, lessons, quizzes, and assignments — with AI-assisted authoring and grading."
      >
        {canEdit && (
          <Button variant="gold" onClick={() => setShowForm(true)}>
            <Plus size={16} /> New Course
          </Button>
        )}
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Courses" value={String(stats.total_courses)} icon={<Layers size={18} />} />
        <KpiCard label="Published" value={String(stats.published_courses)} icon={<BookOpen size={18} />} colorClass="text-emerald-600" />
        <KpiCard label="Lessons" value={String(stats.total_lessons)} icon={<GraduationCap size={18} />} />
        <KpiCard label="Enrollments" value={String(stats.total_enrollments)} icon={<Users size={18} />} />
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : courses.length === 0 ? (
        <EmptyState message="No courses yet. Create your first course to get started." icon={<GraduationCap size={40} />} />
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {courses.map((c) => (
            <Link key={c.id} href={`/dashboard/lms/${c.id}`}>
              <Card className="h-full hover:shadow-md transition-shadow cursor-pointer">
                <div className="h-2 rounded-t-xl -m-px mb-3" style={{ backgroundColor: c.cover_color }} />
                <div className="px-4 pb-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-[#0F2A47] leading-snug">{c.title}</h3>
                    <span className={cn(
                      "shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full",
                      c.status === "published" ? "bg-emerald-100 text-emerald-700" :
                      c.status === "archived" ? "bg-gray-100 text-gray-500" : "bg-amber-100 text-amber-700"
                    )}>
                      {c.status}
                    </span>
                  </div>
                  {c.description && <p className="text-xs text-gray-500 line-clamp-2">{c.description}</p>}
                  <div className="flex flex-wrap gap-1.5 text-[11px] text-gray-500">
                    {c.subject_id && subjectById.get(c.subject_id) && (
                      <span className="bg-gray-100 rounded-full px-2 py-0.5">{subjectById.get(c.subject_id)}</span>
                    )}
                    {c.class_id && classById.get(c.class_id) && (
                      <span className="bg-gray-100 rounded-full px-2 py-0.5">{classById.get(c.class_id)}</span>
                    )}
                    {c.teacher_staff_id && staffById.get(c.teacher_staff_id) && (
                      <span className="bg-gray-100 rounded-full px-2 py-0.5">{staffById.get(c.teacher_staff_id)}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-gray-100 text-xs text-gray-500">
                    <span className="flex items-center gap-1"><BookOpen size={12} /> {lessonCounts[c.id] || 0} lessons</span>
                    <span className="flex items-center gap-1"><Users size={12} /> {enrollCounts[c.id] || 0} enrolled</span>
                    {c.leaderboard_enabled && <span className="flex items-center gap-1 text-[#C9A227]"><Trophy size={12} /></span>}
                    <ChevronRight size={14} className="text-gray-300" />
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Modal open={showForm} onClose={() => setShowForm(false)} title="New Course" size="lg">
        <div className="space-y-3">
          <Input label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Introduction to Algebra" />
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
              placeholder="What will students learn in this course?"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Subject"
              value={form.subject_id}
              onChange={(e) => setForm({ ...form, subject_id: e.target.value })}
              options={subjects.map((s) => ({ value: s.id, label: s.name }))}
              placeholder="Any subject"
            />
            <Select
              label="Class / Grade"
              value={form.class_id}
              onChange={(e) => setForm({ ...form, class_id: e.target.value })}
              options={classes.map((c) => ({ value: c.id, label: c.name }))}
              placeholder="Open to all"
            />
          </div>
          <Select
            label="Teacher"
            value={form.teacher_staff_id}
            onChange={(e) => setForm({ ...form, teacher_staff_id: e.target.value })}
            options={staff.map((s) => ({ value: s.id, label: s.name }))}
            placeholder="Unassigned"
          />
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Cover color</label>
            <div className="flex gap-2">
              {COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setForm({ ...form, cover_color: color })}
                  className={cn("w-7 h-7 rounded-full border-2", form.cover_color === color ? "border-[#0F2A47] scale-110" : "border-transparent")}
                  style={{ backgroundColor: color }}
                  aria-label={color}
                />
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.leaderboard_enabled} onChange={(e) => setForm({ ...form, leaderboard_enabled: e.target.checked })} />
            Enable leaderboard for this course
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button variant="gold" onClick={createCourse} loading={saving}>Create Course</Button>
          </div>
        </div>
      </Modal>

      <ToastHost />
    </div>
  );
}
