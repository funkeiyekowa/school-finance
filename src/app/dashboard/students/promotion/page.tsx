"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtDateTime, cn } from "@/lib/utils";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { CheckCircle2, AlertTriangle, GraduationCap, ArrowRight, ArrowDown, RotateCcw, Users } from "lucide-react";

interface ClassRow { id: string; name: string; short_code: string; sequence: number; next_class_id: string | null; is_terminal: boolean; }
interface YearRow { id: string; name: string; status: string; }
interface StudentRow { id: string; student_code: string; full_name: string; grade: string | null; status: string; }
interface EnrollmentRow { id: string; student_id: string; class_id: string; academic_year_id: string; status: string; }

type PromotionAction = "promote" | "repeat" | "graduate" | "demote" | "skip";
interface StudentEligibility {
  student: StudentRow;
  currentEnrollment: EnrollmentRow | null;
  currentClass: ClassRow | null;
  nextClass: ClassRow | null;
  prevClass: ClassRow | null;
  status: "ready" | "already_promoted" | "graduating" | "no_next_class" | "inactive" | "no_enrollment";
  recommendedAction: PromotionAction;
  selectedAction: PromotionAction | null;
  selectedDestClass: ClassRow | null;
}

export default function PromotionPage() {
  const { isAdmin, profile, orgId } = useAuth();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [years, setYears] = useState<YearRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([]);

  const [fromYearId, setFromYearId] = useState<string>("");
  const [toYearId, setToYearId] = useState<string>("");
  const [eligibility, setEligibility] = useState<StudentEligibility[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [showConfirm, setShowConfirm] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<{ promoted: number; repeated: number; graduated: number; demoted: number; failed: number } | null>(null);
  const [demotionReason, setDemotionReason] = useState("");

  const load = useCallback(async () => {
    const [clsRes, yrRes, stuRes, enrRes] = await Promise.all([
      supabase.from("classes").select("*").eq("active", true).order("sequence"),
      supabase.from("academic_years").select("*").order("name", { ascending: false }),
      supabase.from("students").select("*").eq("status", "active").order("full_name"),
      supabase.from("student_enrollments").select("*"),
    ]);
    setClasses(clsRes.data as ClassRow[] ?? []);
    setYears(yrRes.data as YearRow[] ?? []);
    setStudents(stuRes.data as StudentRow[] ?? []);
    setEnrollments(enrRes.data as EnrollmentRow[] ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  // Auto-select current and upcoming years
  useEffect(() => {
    if (years.length > 0) {
      const current = years.find(y => y.status === "current");
      const upcoming = years.find(y => y.status === "upcoming");
      if (current && !fromYearId) setFromYearId(current.id);
      if (upcoming && !toYearId) setToYearId(upcoming.id);
    }
  }, [years, fromYearId, toYearId]);

  // Calculate eligibility whenever selections change
  useEffect(() => {
    if (!fromYearId || !toYearId || classes.length === 0) {
      setEligibility([]);
      return;
    }

    const eligible: StudentEligibility[] = students.map(student => {
      const currentEnrollment = enrollments.find(
        e => e.student_id === student.id && e.academic_year_id === fromYearId
      ) || null;

      const alreadyInDest = enrollments.find(
        e => e.student_id === student.id && e.academic_year_id === toYearId
      );

      const currentClass = currentEnrollment
        ? classes.find(c => c.id === currentEnrollment.class_id) || null
        : classes.find(c => c.name === student.grade || c.short_code === student.grade) || null;

      const nextClass = currentClass?.next_class_id
        ? classes.find(c => c.id === currentClass.next_class_id) || null
        : currentClass
          ? classes.filter(c => c.sequence > currentClass.sequence).sort((a, b) => a.sequence - b.sequence)[0] || null
          : null;

      // One step down by sequence — the default suggestion when demoting.
      // Any class with a lower sequence can still be picked explicitly (multi-step demotion).
      const prevClass = currentClass
        ? classes.filter(c => c.sequence < currentClass.sequence).sort((a, b) => b.sequence - a.sequence)[0] || null
        : null;

      let status: StudentEligibility["status"] = "ready";
      let recommendedAction: PromotionAction = "promote";

      if (student.status !== "active") {
        status = "inactive";
        recommendedAction = "repeat";
      } else if (alreadyInDest) {
        status = "already_promoted";
        recommendedAction = "promote";
      } else if (currentClass?.is_terminal) {
        status = "graduating";
        recommendedAction = "graduate";
      } else if (!nextClass && !currentClass?.is_terminal) {
        status = "no_next_class";
        recommendedAction = "repeat";
      } else if (!currentEnrollment && !currentClass) {
        status = "no_enrollment";
        recommendedAction = "promote";
      }

      return {
        student,
        currentEnrollment,
        currentClass,
        nextClass,
        prevClass,
        status,
        recommendedAction,
        selectedAction: null,
        selectedDestClass: nextClass,
      };
    });

    setEligibility(eligible);
    setSelectedIds(new Set());
  }, [fromYearId, toYearId, students, enrollments, classes]);

  const counts = {
    total: eligibility.length,
    ready: eligibility.filter(e => e.status === "ready").length,
    already: eligibility.filter(e => e.status === "already_promoted").length,
    graduating: eligibility.filter(e => e.status === "graduating").length,
    noNext: eligibility.filter(e => e.status === "no_next_class").length,
    inactive: eligibility.filter(e => e.status === "inactive").length,
    noEnrollment: eligibility.filter(e => e.status === "no_enrollment").length,
  };

  const actionableStudents = eligibility.filter(
    e => selectedIds.has(e.student.id) && e.status !== "already_promoted" && e.status !== "inactive"
  );

  function setItemAction(studentId: string, action: PromotionAction) {
    setEligibility(prev => prev.map(item => {
      if (item.student.id !== studentId) return item;
      const destClass =
        action === "promote" ? item.nextClass :
        action === "demote" ? item.prevClass :
        action === "repeat" ? item.currentClass :
        null; // graduate / skip carry no destination class
      return { ...item, selectedAction: action, selectedDestClass: destClass };
    }));
  }

  function setItemDestClass(studentId: string, classId: string) {
    const cls = classes.find(c => c.id === classId) || null;
    setEligibility(prev => prev.map(item =>
      item.student.id === studentId ? { ...item, selectedDestClass: cls } : item
    ));
  }

  function toggleAll(checked: boolean) {
    if (checked) {
      const actionable = eligibility
        .filter(e => e.status !== "already_promoted" && e.status !== "inactive")
        .map(e => e.student.id);
      setSelectedIds(new Set(actionable));
    } else {
      setSelectedIds(new Set());
    }
  }

  async function executePromotion() {
    if (actionableStudents.length === 0) return;
    setExecuting(true);

    const batchCode = `PROM-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;
    const { data: batch } = await supabase.from("promotion_batches").insert({
      batch_code: batchCode,
      from_year_id: fromYearId,
      to_year_id: toYearId,
      status: "pending",
      total_students: actionableStudents.length,
      created_by_email: profile?.email,
      created_by_name: profile?.full_name,
      organization_id: orgId,
    }).select("id").single();

    if (!batch) { setExecuting(false); return; }

    let promoted = 0, repeated = 0, graduated = 0, demoted = 0, failed = 0;

    for (const item of actionableStudents) {
      const action = item.selectedAction || item.recommendedAction;
      const destClass = action === "repeat"
        ? item.currentClass
        : action === "graduate"
          ? null
          : action === "demote"
            ? item.selectedDestClass || item.prevClass
            : item.selectedDestClass || item.nextClass;

      try {
        // Create enrollment for destination year
        let toEnrollmentId: string | null = null;
        if (destClass && action !== "graduate") {
          const { data: newEnrollment } = await supabase.from("student_enrollments").insert({
            student_id: item.student.id,
            class_id: destClass.id,
            academic_year_id: toYearId,
            status: "active",
            promoted_from_id: item.currentEnrollment?.id || null,
            organization_id: orgId,
          }).select("id").single();
          toEnrollmentId = newEnrollment?.id || null;
        }

        // Mark current enrollment as completed/repeated/graduated/demoted
        if (item.currentEnrollment) {
          const newStatus =
            action === "repeat" ? "repeated" :
            action === "graduate" ? "graduated" :
            action === "demote" ? "demoted" :
            "completed";
          await supabase.from("student_enrollments")
            .update({ status: newStatus, updated_at: new Date().toISOString() })
            .eq("id", item.currentEnrollment.id);
        }

        // Update student's grade field to the new class (preserves the current-class lookup)
        if (destClass && action !== "graduate") {
          await supabase.from("students")
            .update({ grade: destClass.name, updated_at: new Date().toISOString() })
            .eq("id", item.student.id);
        } else if (action === "graduate") {
          await supabase.from("students")
            .update({ status: "graduated", updated_at: new Date().toISOString() })
            .eq("id", item.student.id);
        }

        // Record promotion event
        await supabase.from("promotion_events").insert({
          batch_id: batch.id,
          student_id: item.student.id,
          from_enrollment_id: item.currentEnrollment?.id || null,
          to_enrollment_id: toEnrollmentId,
          from_class_id: item.currentClass?.id || null,
          to_class_id: destClass?.id || null,
          from_year_id: fromYearId,
          to_year_id: toYearId,
          action:
            action === "promote" ? "promoted" :
            action === "repeat" ? "repeated" :
            action === "demote" ? "demoted" :
            "graduated",
          reason: action === "demote" ? (demotionReason.trim() || "Demoted by administrator") : null,
          status: "completed",
          created_by_email: profile?.email,
          created_by_name: profile?.full_name,
          organization_id: orgId,
        });

        if (action === "promote" || action === "skip") promoted++;
        else if (action === "repeat") repeated++;
        else if (action === "graduate") graduated++;
        else if (action === "demote") demoted++;
      } catch {
        failed++;
      }
    }

    // Update batch summary. promotion_batches has no dedicated "demoted"
    // column (this feature was added without a schema migration), so the
    // demoted count is recorded in notes for the audit trail; the
    // per-student truth lives in promotion_events (action='demoted').
    await supabase.from("promotion_batches").update({
      status: "completed",
      promoted, repeated, graduated, failed,
      notes: demoted > 0 ? `${demoted} student(s) demoted` : null,
      updated_at: new Date().toISOString(),
    }).eq("id", batch.id);

    await supabase.from("activity_log").insert({
      user_email: profile?.email, user_name: profile?.full_name,
      action: "Bulk Promotion",
      details: `${batchCode}: ${promoted} promoted, ${repeated} repeated, ${graduated} graduated, ${demoted} demoted, ${failed} failed`,
      organization_id: orgId,
    });

    setResult({ promoted, repeated, graduated, demoted, failed });
    setShowConfirm(false);
    setExecuting(false);
    setDemotionReason("");
    load();
  }

  if (!isAdmin) return <div className="p-6 text-gray-500">Admin access required.</div>;
  if (loading) return <div className="p-6"><LoadingSpinner /></div>;

  const fromYear = years.find(y => y.id === fromYearId);
  const toYear = years.find(y => y.id === toYearId);

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Promotion Center" subtitle="Promote students to the next academic year and class" />

      {/* Year selection */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">From Academic Year</label>
              <select value={fromYearId} onChange={e => setFromYearId(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]">
                <option value="">Select...</option>
                {years.map(y => <option key={y.id} value={y.id}>{y.name} ({y.status})</option>)}
              </select>
            </div>
            <ArrowRight size={20} className="text-gray-400 mt-5" />
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">To Academic Year</label>
              <select value={toYearId} onChange={e => setToYearId(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]">
                <option value="">Select...</option>
                {years.filter(y => y.id !== fromYearId).map(y => <option key={y.id} value={y.id}>{y.name} ({y.status})</option>)}
              </select>
            </div>
            {fromYearId && toYearId && fromYear && toYear && fromYear.name >= toYear.name && (
              <div className="flex items-center gap-1 text-amber-700 text-xs mt-5">
                <AlertTriangle size={14} /> Destination year should be after the source year.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      {fromYearId && toYearId && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {[
            { label: "Total Students", value: counts.total, color: "text-[#0F2A47]" },
            { label: "Ready", value: counts.ready, color: "text-green-700" },
            { label: "Already Promoted", value: counts.already, color: "text-blue-600" },
            { label: "Graduating", value: counts.graduating, color: "text-purple-700" },
            { label: "No Next Class", value: counts.noNext, color: "text-amber-700" },
            { label: "Inactive", value: counts.inactive, color: "text-gray-500" },
            { label: "No Enrollment", value: counts.noEnrollment, color: "text-gray-400" },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl border p-3 text-center">
              <div className="text-xs text-gray-500 mb-1">{s.label}</div>
              <div className={cn("text-xl font-bold", s.color)}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Student table */}
      {fromYearId && toYearId && eligibility.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Students ({eligibility.length})</CardTitle>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">{selectedIds.size} selected</span>
                <Button size="sm" variant="gold" disabled={actionableStudents.length === 0} onClick={() => setShowConfirm(true)}>
                  <ArrowRight size={14} /> Apply to {actionableStudents.length} Students
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white z-10">
                  <tr className="bg-gray-50 border-b">
                    <th className="w-8 px-2 py-2">
                      <input type="checkbox"
                        checked={selectedIds.size > 0 && selectedIds.size === eligibility.filter(e => e.status !== "already_promoted" && e.status !== "inactive").length}
                        onChange={e => toggleAll(e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300 text-[#C9A227] focus:ring-[#C9A227]"
                      />
                    </th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Code</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Name</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Current Class</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Status</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Action</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">→ Destination</th>
                  </tr>
                </thead>
                <tbody>
                  {eligibility.map(item => {
                    const disabled = item.status === "already_promoted" || item.status === "inactive";
                    const action = item.selectedAction || item.recommendedAction;
                    const needsDestPicker = action === "promote" || action === "demote";
                    return (
                      <tr key={item.student.id} className={cn("border-b", disabled && "opacity-50")}>
                        <td className="px-2 py-2">
                          <input type="checkbox" disabled={disabled}
                            checked={selectedIds.has(item.student.id)}
                            onChange={e => {
                              const next = new Set(selectedIds);
                              e.target.checked ? next.add(item.student.id) : next.delete(item.student.id);
                              setSelectedIds(next);
                            }}
                            className="w-4 h-4 rounded border-gray-300 text-[#C9A227] focus:ring-[#C9A227]"
                          />
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-500">{item.student.student_code}</td>
                        <td className="px-3 py-2 font-medium">{item.student.full_name}</td>
                        <td className="px-3 py-2 text-gray-600">{item.currentClass?.name || item.student.grade || "—"}</td>
                        <td className="px-3 py-2">
                          <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                            item.status === "ready" ? "bg-green-100 text-green-700" :
                            item.status === "already_promoted" ? "bg-blue-100 text-blue-600" :
                            item.status === "graduating" ? "bg-purple-100 text-purple-700" :
                            item.status === "no_next_class" ? "bg-amber-100 text-amber-700" :
                            "bg-gray-100 text-gray-500"
                          )}>{item.status.replace(/_/g, " ")}</span>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            disabled={disabled}
                            value={action}
                            onChange={e => setItemAction(item.student.id, e.target.value as PromotionAction)}
                            className="text-xs px-2 py-1 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C9A227] disabled:bg-gray-50"
                          >
                            <option value="promote">Promote</option>
                            <option value="repeat">Repeat class</option>
                            <option value="demote">Demote</option>
                            {item.currentClass?.is_terminal && <option value="graduate">Graduate</option>}
                            <option value="skip">Skip (no change)</option>
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          {action === "graduate" ? (
                            <span className="text-purple-700 font-medium text-xs">Graduation</span>
                          ) : action === "skip" ? (
                            <span className="text-gray-400 text-xs">—</span>
                          ) : action === "repeat" ? (
                            <span className="text-amber-700 text-xs">{item.currentClass?.name || "same class"}</span>
                          ) : needsDestPicker ? (
                            <select
                              disabled={disabled}
                              value={item.selectedDestClass?.id || ""}
                              onChange={e => setItemDestClass(item.student.id, e.target.value)}
                              className={cn(
                                "text-xs px-2 py-1 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C9A227] disabled:bg-gray-50",
                                action === "demote" ? "border-amber-300" : "border-gray-300"
                              )}
                            >
                              <option value="">Select class…</option>
                              {classes
                                .filter(c => action === "demote"
                                  ? (!item.currentClass || c.sequence < item.currentClass.sequence)
                                  : (!item.currentClass || c.sequence > item.currentClass.sequence))
                                .sort((a, b) => action === "demote" ? b.sequence - a.sequence : a.sequence - b.sequence)
                                .map(c => (
                                  <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                          ) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Result banner */}
      {result && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-xl flex items-start gap-3">
          <CheckCircle2 size={20} className="text-green-600 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-green-800">Batch Complete</div>
            <p className="text-sm text-green-700 mt-1">
              {result.promoted} promoted, {result.repeated} repeated, {result.demoted} demoted, {result.graduated} graduated
              {result.failed > 0 && <span className="text-red-600">, {result.failed} failed</span>}
            </p>
          </div>
        </div>
      )}

      {/* Confirmation modal */}
      {showConfirm && (() => {
        const promotingCount = actionableStudents.filter(s => (s.selectedAction || s.recommendedAction) === "promote").length;
        const repeatingCount = actionableStudents.filter(s => (s.selectedAction || s.recommendedAction) === "repeat").length;
        const demotingCount = actionableStudents.filter(s => (s.selectedAction || s.recommendedAction) === "demote").length;
        const graduatingCount = actionableStudents.filter(s => (s.selectedAction || s.recommendedAction) === "graduate").length;
        const missingDest = actionableStudents.filter(s => {
          const a = s.selectedAction || s.recommendedAction;
          return (a === "promote" || a === "demote") && !s.selectedDestClass;
        });
        return (
        <Modal open onClose={() => setShowConfirm(false)} title="Confirm Batch" size="lg">
          <div className="space-y-4">
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-sm text-amber-800">
                You are about to create <strong>{actionableStudents.length}</strong> new academic enrollments
                from <strong>{fromYear?.name}</strong> to <strong>{toYear?.name}</strong>.
              </p>
              <p className="text-xs text-amber-700 mt-2">
                No historical enrollment records will be deleted. Each student&apos;s previous class
                assignment remains intact for fee matching, payments, and reports.
              </p>
            </div>

            {missingDest.length > 0 && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {missingDest.length} student(s) have &quot;Promote&quot; or &quot;Demote&quot; selected but no destination
                class chosen. Pick a destination class for each before continuing.
              </div>
            )}

            <div className="grid grid-cols-4 gap-3 text-center">
              <div className="bg-green-50 rounded-lg p-3">
                <div className="text-xl font-bold text-green-700">{promotingCount}</div>
                <div className="text-xs text-green-600">Promoting</div>
              </div>
              <div className="bg-amber-50 rounded-lg p-3">
                <div className="text-xl font-bold text-amber-700">{repeatingCount}</div>
                <div className="text-xs text-amber-600">Repeating</div>
              </div>
              <div className="bg-orange-50 rounded-lg p-3">
                <div className="text-xl font-bold text-orange-700">{demotingCount}</div>
                <div className="text-xs text-orange-600 flex items-center justify-center gap-1"><ArrowDown size={11} /> Demoting</div>
              </div>
              <div className="bg-purple-50 rounded-lg p-3">
                <div className="text-xl font-bold text-purple-700">{graduatingCount}</div>
                <div className="text-xs text-purple-600">Graduating</div>
              </div>
            </div>

            {demotingCount > 0 && (
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  Reason for demotion <span className="text-gray-400">(applies to all demotions in this batch, recorded in the audit trail)</span>
                </label>
                <input
                  type="text"
                  value={demotionReason}
                  onChange={e => setDemotionReason(e.target.value)}
                  placeholder="e.g. Did not meet promotion criteria at end-of-year assessment"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
                />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setShowConfirm(false)}>Cancel</Button>
              <Button variant="gold" loading={executing} disabled={missingDest.length > 0} onClick={executePromotion}>
                <GraduationCap size={14} /> Confirm & Apply
              </Button>
            </div>
          </div>
        </Modal>
        );
      })()}
    </div>
  );
}
