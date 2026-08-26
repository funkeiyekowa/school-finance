"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtMoney, cn } from "@/lib/utils";
import { PageHeader, KpiCard, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Users, GraduationCap, Wallet, Clock, FileBarChart, TrendingUp, MessageSquare, Receipt, BookOpen, ChevronRight, Award } from "lucide-react";

interface Student { id: string; student_code: string; full_name: string; grade: string | null; status: string; guardian_email: string | null; guardian_phone: string | null; }
interface Payment { id: string; student_id: string | null; receipt_no: string; date: string; amount: number; category: string; }
interface Attendance { id: string; student_id: string; date: string; status_code: string; }
interface Exam { id: string; student_id: string; exam_id: string; total_score: number | null; status: string; }
interface ReportCard { id: string; student_id: string; term: string; average_score: number; grade_overall: string | null; published: boolean; }

export default function ParentPortalPage() {
  const { user } = useAuth();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [children, setChildren] = useState<Student[]>([]);
  const [payments, setPayments] = useState<Record<string, Payment[]>>({});
  const [attendance, setAttendance] = useState<Record<string, Attendance[]>>({});
  const [reportCards, setReportCards] = useState<Record<string, ReportCard[]>>({});
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);

    // Try links table first, then fallback to guardian_email
    let childIds: string[] = [];
    const { data: linksData } = await supabase
      .from("parent_student_links")
      .select("student_id, parent_id")
      .eq("parent_id", user.id);

    if (linksData && linksData.length > 0) {
      childIds = linksData.map((l) => (l as { student_id: string }).student_id);
    }

    let childRows: Student[] = [];
    if (childIds.length > 0) {
      const { data } = await supabase.from("students").select("*").in("id", childIds);
      childRows = (data ?? []) as Student[];
    } else {
      const { data } = await supabase.from("students").select("*")
        .eq("guardian_email", user.email).eq("status", "active");
      childRows = (data ?? []) as Student[];
    }

    setChildren(childRows);
    if (childRows.length > 0) setSelectedChildId(childRows[0].id);

    const allIds = childRows.map(c => c.id);
    if (allIds.length > 0) {
      const [pay, att, rc] = await Promise.all([
        supabase.from("income_entries").select("*").in("student_id", allIds).order("date", { ascending: false }).limit(200),
        supabase.from("attendance_records").select("id, student_id, date, status_code").in("student_id", allIds).order("date", { ascending: false }).limit(500),
        supabase.from("report_cards").select("id, student_id, term, average_score, grade_overall, published").in("student_id", allIds),
      ]);

      const paymentsBy: Record<string, Payment[]> = {};
      const attendanceBy: Record<string, Attendance[]> = {};
      const rcBy: Record<string, ReportCard[]> = {};

      allIds.forEach(id => { paymentsBy[id] = []; attendanceBy[id] = []; rcBy[id] = []; });
      (pay.data ?? []).forEach(p => {
        const rec = p as Payment;
        if (rec.student_id) paymentsBy[rec.student_id]?.push(rec);
      });
      (att.data ?? []).forEach(a => {
        const rec = a as Attendance;
        attendanceBy[rec.student_id]?.push(rec);
      });
      (rc.data ?? []).forEach(r => {
        const rec = r as ReportCard;
        rcBy[rec.student_id]?.push(rec);
      });

      setPayments(paymentsBy);
      setAttendance(attendanceBy);
      setReportCards(rcBy);
    }

    setLoading(false);
  }, [user, supabase]);

  useEffect(() => { load(); }, [load]);

  const selectedChild = children.find(c => c.id === selectedChildId);
  const childPayments = selectedChildId ? payments[selectedChildId] || [] : [];
  const childAttendance = selectedChildId ? attendance[selectedChildId] || [] : [];
  const childReportCards = selectedChildId ? reportCards[selectedChildId] || [] : [];

  const stats = useMemo(() => {
    const totalPaid = childPayments.reduce((s, p) => s + Number(p.amount), 0);
    const present = childAttendance.filter(a => a.status_code === "P" || a.status_code === "present").length;
    const rate = childAttendance.length > 0 ? Math.round((present / childAttendance.length) * 100) : 0;
    const lastRc = childReportCards.filter(r => r.published)[0];
    return { totalPaid, attendance: rate, lastAvg: lastRc?.average_score || null, lastGrade: lastRc?.grade_overall || null };
  }, [childPayments, childAttendance, childReportCards]);

  if (loading) return <LoadingSpinner />;

  if (children.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Parent Portal" subtitle="View and support your children's academic journey" />
        <EmptyState message="No children linked to your account. Contact your school administrator to link your children." icon={<Users />} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Parent Portal" subtitle={`Welcome — you have ${children.length} ${children.length === 1 ? "child" : "children"} enrolled`} />

      {/* Child selector */}
      {children.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {children.map(c => (
            <button
              key={c.id}
              onClick={() => setSelectedChildId(c.id)}
              className={cn(
                "px-4 py-2 rounded-lg border font-semibold text-sm transition-all",
                selectedChildId === c.id
                  ? "bg-[#C9A227] text-white border-[#C9A227] shadow"
                  : "bg-white border-gray-200 text-gray-700 hover:border-[#C9A227]"
              )}
            >
              {c.full_name} · {c.grade || "—"}
            </button>
          ))}
        </div>
      )}

      {selectedChild && (
        <>
          {/* Overview */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#C9A227] to-[#8a6d1a] flex items-center justify-center text-white text-2xl font-bold">
                  {selectedChild.full_name.split(" ").map(n => n[0]).slice(0, 2).join("")}
                </div>
                <div className="flex-1">
                  <h2 className="text-xl font-bold text-[#0F2A47]">{selectedChild.full_name}</h2>
                  <p className="text-sm text-gray-500">
                    <span className="font-mono">{selectedChild.student_code}</span> · {selectedChild.grade || "Unassigned"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard label="Attendance" value={`${stats.attendance}%`} icon={<Clock size={18} />} colorClass="text-[#C9A227]" />
            <KpiCard label="Total Paid" value={fmtMoney(stats.totalPaid)} icon={<Wallet size={18} />} colorClass="text-green-700" />
            <KpiCard label="Last Average" value={stats.lastAvg ? `${Number(stats.lastAvg).toFixed(1)}%` : "—"} icon={<Award size={18} />} colorClass="text-blue-700" />
            <KpiCard label="Overall Grade" value={stats.lastGrade || "—"} icon={<GraduationCap size={18} />} colorClass="text-amber-700" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Recent Payments */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Receipt size={16} /> Recent Payments</CardTitle>
              </CardHeader>
              <CardContent>
                {childPayments.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">No payments recorded.</p>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto">
                    {childPayments.slice(0, 10).map(p => (
                      <div key={p.id} className="flex items-center justify-between p-2 border-b">
                        <div>
                          <div className="text-sm font-medium">{p.category}</div>
                          <div className="text-xs text-gray-500">{p.date} · {p.receipt_no}</div>
                        </div>
                        <div className="font-semibold text-green-700">{fmtMoney(Number(p.amount))}</div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Report Cards */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><FileBarChart size={16} /> Report Cards</CardTitle>
              </CardHeader>
              <CardContent>
                {childReportCards.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">No report cards published yet.</p>
                ) : (
                  <div className="space-y-2">
                    {childReportCards.map(rc => (
                      <Link key={rc.id} href={`/dashboard/report-cards/${rc.id}`}
                        className={cn("flex items-center justify-between p-3 border rounded-lg hover:border-[#C9A227] transition-colors",
                          !rc.published && "opacity-60")}>
                        <div>
                          <div className="text-sm font-semibold">{rc.term}</div>
                          <div className="text-xs text-gray-500">{rc.published ? "Published" : "Draft"}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <div className="font-bold text-[#0F2A47]">{Number(rc.average_score).toFixed(1)}%</div>
                            <div className="text-xs text-gray-500">Grade {rc.grade_overall || "—"}</div>
                          </div>
                          <ChevronRight size={16} className="text-gray-400" />
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Attendance summary */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Clock size={16} /> Recent Attendance</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-7 gap-1">
                  {childAttendance.slice(0, 28).reverse().map(a => (
                    <div key={a.id} className={cn("aspect-square rounded flex flex-col items-center justify-center text-xs",
                      a.status_code === "P" || a.status_code === "present" ? "bg-green-100 text-green-700" :
                      a.status_code === "A" || a.status_code === "absent" ? "bg-red-100 text-red-700" :
                      "bg-amber-100 text-amber-700"
                    )}>
                      <span className="font-mono text-[9px]">{a.date.slice(5)}</span>
                      <span className="font-bold text-sm">{a.status_code}</span>
                    </div>
                  ))}
                </div>
                {childAttendance.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No attendance records.</p>}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Quick Links</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Link href="/dashboard/my-children" className="p-4 rounded-xl border border-gray-200 hover:border-[#C9A227] transition-colors">
                  <Users size={20} className="text-[#C9A227] mb-2" />
                  <div className="font-semibold text-sm">All My Children</div>
                </Link>
                <Link href="/dashboard/announcements" className="p-4 rounded-xl border border-gray-200 hover:border-[#C9A227] transition-colors">
                  <MessageSquare size={20} className="text-[#C9A227] mb-2" />
                  <div className="font-semibold text-sm">School News</div>
                </Link>
                <Link href="/dashboard/report-cards" className="p-4 rounded-xl border border-gray-200 hover:border-[#C9A227] transition-colors">
                  <FileBarChart size={20} className="text-[#C9A227] mb-2" />
                  <div className="font-semibold text-sm">Report Cards</div>
                </Link>
                <Link href="/dashboard/receipts" className="p-4 rounded-xl border border-gray-200 hover:border-[#C9A227] transition-colors">
                  <Receipt size={20} className="text-[#C9A227] mb-2" />
                  <div className="font-semibold text-sm">Receipts</div>
                </Link>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
