"use client";

/**
 * /dashboard/child-courses
 *
 * Lets a parent browse the school's published courses and enrol one of
 * their children.
 *
 * Both reads and the write go through SECURITY DEFINER RPCs rather than
 * direct table access, because lms_courses' phase-1 read policy is scoped
 * to staff and already-enrolled students — a parent browsing the
 * catalogue would otherwise see nothing — and lms_enrollments' self-insert
 * policy is student-only by construction. See
 * supabase/parent_course_enrolment.sql for why that is an RPC and not a
 * policy change.
 */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/lib/hooks/useToast";
import { GraduationCap, Check, Plus } from "lucide-react";

interface ChildOption { id: string; name: string }

interface CourseRow {
  course_id: string;
  title: string;
  description: string | null;
  cover_color: string | null;
  class_id: string | null;
  enrolled: boolean;
  enrol_status: string;
}

export default function ChildCoursesPage() {
  const supabase = createClient();
  const { notify, ToastHost } = useToast();

  const [children, setChildren] = useState<ChildOption[]>([]);
  const [childId, setChildId] = useState<string>("");
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // RPC-first child lookup — the same pattern the other portal screens use
  // so a parent with a missing org_memberships row still sees their
  // children (AUDIT_NOTES "S288").
  const loadChildren = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_my_parent_children");
    if (error) notify(`Could not load your children: ${error.message}`, "error");
    const list = Array.isArray(data)
      ? (data as { id?: string; student_id?: string; full_name?: string; name?: string }[])
          .map((k) => ({
            id: String(k.student_id ?? k.id ?? ""),
            name: String(k.full_name ?? k.name ?? "Child"),
          }))
          .filter((k) => k.id)
      : [];
    setChildren(list);
    if (list.length && !childId) setChildId(list[0].id);
    setLoading(false);
  }, [supabase, notify, childId]);

  const loadCourses = useCallback(async () => {
    if (!childId) { setCourses([]); return; }
    setLoadingCourses(true);
    const { data, error } = await supabase.rpc("list_courses_for_my_child", {
      p_student_id: childId,
    });
    if (error) notify(`Could not load courses: ${error.message}`, "error");
    setCourses((data ?? []) as CourseRow[]);
    setLoadingCourses(false);
  }, [supabase, childId, notify]);

  useEffect(() => { loadChildren(); }, [loadChildren]);
  useEffect(() => { loadCourses(); }, [loadCourses]);

  async function enrol(c: CourseRow) {
    if (!childId) return;
    setBusyId(c.course_id);
    const { data, error } = await supabase.rpc("enrol_my_child_in_course", {
      p_course_id: c.course_id,
      p_student_id: childId,
    });
    setBusyId(null);
    if (error) { notify(`Could not enrol: ${error.message}`, "error"); return; }

    const res = data as { ok?: boolean; already_enrolled?: boolean; course?: string } | null;
    if (!res?.ok) { notify("Enrolment was rejected.", "error"); return; }
    notify(
      res.already_enrolled
        ? `Already enrolled in ${res.course ?? c.title}`
        : `Enrolled in ${res.course ?? c.title}`
    );
    loadCourses();
  }

  if (loading) return <LoadingSpinner />;

  if (children.length === 0) {
    return (
      <div className="p-6">
        <PageHeader
          title="Child Courses"
          subtitle="Browse the school's courses and enrol your child."
          icon={<GraduationCap size={20} />}
        />
        <EmptyState
          icon={<GraduationCap size={28} />}
          message="No children are linked to your account yet. Ask the school office to link your child so you can enrol them in courses."
        />
        <ToastHost />
      </div>
    );
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Child Courses"
        subtitle="Browse the school's courses and enrol your child."
        icon={<GraduationCap size={20} />}
      />

      {children.length > 1 && (
        <div className="mb-5">
          <label className="block text-xs font-semibold text-gray-700 mb-1">Child</label>
          <select
            value={childId}
            onChange={(e) => setChildId(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white min-w-64"
          >
            {children.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      {loadingCourses ? (
        <LoadingSpinner />
      ) : courses.length === 0 ? (
        <EmptyState
          icon={<GraduationCap size={28} />}
          message="The school hasn't published any courses yet. They'll appear here once it does."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => {
            const active = c.enrolled && c.enrol_status !== "dropped";
            return (
              <Card key={c.course_id} className="p-4 flex flex-col">
                <div
                  className="h-1.5 rounded-full mb-3"
                  style={{ background: c.cover_color || "#0F2A47" }}
                />
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-[#0F2A47]">{c.title}</h3>
                  {active && <Badge variant="green">Enrolled</Badge>}
                </div>
                {c.description && (
                  <p className="text-sm text-gray-600 mt-1.5 line-clamp-3">{c.description}</p>
                )}
                <div className="mt-auto pt-4">
                  {active ? (
                    <Button size="sm" variant="secondary" disabled>
                      <Check size={13} /> Enrolled
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="gold"
                      disabled={busyId === c.course_id}
                      onClick={() => enrol(c)}
                    >
                      <Plus size={13} />
                      {busyId === c.course_id
                        ? "Enrolling…"
                        : c.enrol_status === "dropped"
                          ? "Re-enrol"
                          : "Enrol"}
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <ToastHost />
    </div>
  );
}
