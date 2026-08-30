"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtMoney, fmtDate, cn } from "@/lib/utils";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Users, Receipt, FileBarChart } from "lucide-react";

interface StudentRow { id: string; student_code: string; full_name: string; grade: string | null; status: string; }
interface FeeRow { id: string; name: string; amount: number; grade: string | null; }
interface PaymentRow { id: string; receipt_no: string; date: string; amount: number; category: string; }
interface AttendanceRow { status_code: string; }

export default function MyChildrenPage() {
  const { user } = useAuth();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [children, setChildren] = useState<StudentRow[]>([]);
  const [fees, setFees] = useState<FeeRow[]>([]);
  const [payments, setPayments] = useState<Record<string, PaymentRow[]>>({});
  const [attendance, setAttendance] = useState<Record<string, AttendanceRow[]>>({});
  const [selectedChild, setSelectedChild] = useState<string | null>(null);

  const loadChildData = useCallback(async (stuList: StudentRow[]) => {
    const ids = stuList.map((s) => s.id);
    // 3 queries in parallel — the old for-of loop did 2 * children serially.
    const [feesRes, paysRes, attRes] = await Promise.all([
      supabase.from("fee_schedules").select("id, name, amount, grade").eq("active", true),
      ids.length
        ? supabase
            .from("income_entries")
            .select("id, receipt_no, date, amount, category, student_id")
            .in("student_id", ids)
            .order("date", { ascending: false })
        : Promise.resolve({ data: [] }),
      ids.length
        ? supabase.from("attendance_records").select("status_code, student_id").in("student_id", ids)
        : Promise.resolve({ data: [] }),
    ]);
    setFees((feesRes.data as FeeRow[]) ?? []);

    const payMap: Record<string, PaymentRow[]> = {};
    const attMap: Record<string, AttendanceRow[]> = {};
    for (const stu of stuList) {
      payMap[stu.id] = [];
      attMap[stu.id] = [];
    }
    for (const row of ((paysRes.data as (PaymentRow & { student_id: string })[]) ?? [])) {
      const list = payMap[row.student_id];
      if (list && list.length < 10) list.push(row);
    }
    for (const row of ((attRes.data as (AttendanceRow & { student_id: string })[]) ?? [])) {
      const list = attMap[row.student_id];
      if (list) list.push(row);
    }
    setPayments(payMap);
    setAttendance(attMap);
  }, [supabase]);

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }

    // Canonical link chain (matches parent-portal, parents CRUD, and RLS):
    //   auth.users.id → parent_profiles.profile_id → parent_student_links.parent_id → students.id
    // The older parent_students table (linked directly to auth.uid) is
    // still in the schema for backward compatibility but no longer read
    // from anywhere — parents/page.tsx writes to parent_student_links so
    // reading the old table produced empty results on new-user paths.
    const { data: pp } = await supabase
      .from("parent_profiles")
      .select("id")
      .eq("profile_id", user.id)
      .maybeSingle();

    let studentIds: string[] = [];
    if (pp?.id) {
      const { data: links } = await supabase
        .from("parent_student_links")
        .select("student_id")
        .eq("parent_id", pp.id);
      studentIds = (links ?? []).map((l) => l.student_id);
    }

    if (studentIds.length === 0) {
      // Fallback: match on guardian_email so pre-provisioning tests
      // (parent row inserted but not yet linked) still show something.
      const { data: emailMatch } = await supabase
        .from("students")
        .select("*")
        .eq("guardian_email", user.email)
        .eq("status", "active");
      setChildren((emailMatch as StudentRow[]) ?? []);
      if (emailMatch && emailMatch.length > 0) {
        await loadChildData(emailMatch as StudentRow[]);
      }
      setLoading(false);
      return;
    }

    const { data: stuData } = await supabase
      .from("students")
      .select("*")
      .in("id", studentIds)
      .order("full_name");

    const stuList = (stuData as StudentRow[]) ?? [];
    setChildren(stuList);
    await loadChildData(stuList);
    setLoading(false);
  }, [user, supabase, loadChildData]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;
  if (children.length === 0) return <div className="p-6 text-gray-500">No children linked to your account. Contact the school administrator.</div>;

  const activeChild = selectedChild ? children.find(c => c.id === selectedChild) : children[0];
  if (!activeChild) return null;

  const childFees = fees.filter(f => !f.grade || f.grade === activeChild.grade);
  const totalDue = childFees.reduce((s, f) => s + f.amount, 0);
  const childPayments = payments[activeChild.id] || [];
  const totalPaid = childPayments.reduce((s, p) => s + p.amount, 0);
  const balance = totalDue - totalPaid;

  const childAtt = attendance[activeChild.id] || [];
  const attTotal = childAtt.length;
  const attPresent = childAtt.filter(a => a.status_code === "present" || a.status_code === "late").length;
  const attPct = attTotal > 0 ? Math.round((attPresent / attTotal) * 100) : 0;

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="My Children" subtitle="View your children's fees, payments, attendance, and results" />

      {/* Child selector */}
      {children.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {children.map(child => (
            <button key={child.id}
              onClick={() => setSelectedChild(child.id)}
              className={cn("px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                (selectedChild || children[0].id) === child.id
                  ? "bg-[#0F2A47] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}>
              {child.full_name}
            </button>
          ))}
        </div>
      )}

      {/* Child info + balance */}
      <div className="grid sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="py-4 text-center">
            <div className="text-lg font-bold text-[#0F2A47]">{activeChild.full_name}</div>
            <div className="text-xs text-gray-500">{activeChild.student_code} · {activeChild.grade || "—"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <div className="text-xl font-bold text-[#0F2A47]">{fmtMoney(totalDue)}</div>
            <div className="text-xs text-gray-500">Total Fees Due</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <div className="text-xl font-bold text-green-700">{fmtMoney(totalPaid)}</div>
            <div className="text-xs text-gray-500">Total Paid</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <div className={cn("text-xl font-bold", balance > 0 ? "text-red-700" : "text-green-700")}>{fmtMoney(Math.abs(balance))}</div>
            <div className="text-xs text-gray-500">{balance > 0 ? "Outstanding" : "Credit"}</div>
          </CardContent>
        </Card>
      </div>

      {/* Attendance */}
      <Card>
        <CardHeader><CardTitle>Attendance</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
              <div className={cn("h-full rounded-full", attPct >= 75 ? "bg-green-500" : attPct >= 50 ? "bg-amber-500" : "bg-red-500")} style={{ width: `${attPct}%` }} />
            </div>
            <span className="text-sm font-bold">{attPct}%</span>
            <span className="text-xs text-gray-400">({attPresent}/{attTotal} days)</span>
          </div>
        </CardContent>
      </Card>

      {/* Recent payments */}
      <Card>
        <CardHeader><CardTitle>Recent Payments</CardTitle></CardHeader>
        <CardContent>
          {childPayments.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No payments recorded.</p>
          ) : (
            <div className="space-y-2">
              {childPayments.slice(0, 5).map(p => (
                <div key={p.id} className="flex items-center justify-between p-2 border-b border-gray-50">
                  <div>
                    <div className="text-sm font-medium">{p.receipt_no}</div>
                    <div className="text-xs text-gray-400">{fmtDate(p.date)} · {p.category}</div>
                  </div>
                  <span className="text-sm font-bold text-green-700">{fmtMoney(p.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fees breakdown */}
      <Card>
        <CardHeader><CardTitle>Fee Schedule</CardTitle></CardHeader>
        <CardContent>
          {childFees.map(f => (
            <div key={f.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
              <span className="text-sm text-gray-700">{f.name}</span>
              <span className="text-sm font-semibold">{fmtMoney(f.amount)}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
