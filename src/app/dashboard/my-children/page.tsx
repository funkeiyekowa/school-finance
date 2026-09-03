"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useToast } from "@/lib/hooks/useToast";
import { uploadProfilePhoto } from "@/lib/photos/storage";
import { fmtMoney, fmtDate, cn } from "@/lib/utils";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Users, Receipt, FileBarChart, Camera, Clock } from "lucide-react";

interface StudentRow { id: string; student_code: string; full_name: string; grade: string | null; status: string; photo_url: string | null; }
interface FeeRow { id: string; name: string; amount: number; grade: string | null; }
interface PaymentRow { id: string; receipt_no: string; date: string; amount: number; category: string; }
interface AttendanceRow { status_code: string; }

export default function MyChildrenPage() {
  const { user, orgId } = useAuth();
  const supabase = createClient();
  const { notify, ToastHost } = useToast();
  const [loading, setLoading] = useState(true);
  const [children, setChildren] = useState<StudentRow[]>([]);
  const [fees, setFees] = useState<FeeRow[]>([]);
  const [payments, setPayments] = useState<Record<string, PaymentRow[]>>({});
  const [attendance, setAttendance] = useState<Record<string, AttendanceRow[]>>({});
  const [selectedChild, setSelectedChild] = useState<string | null>(null);
  const [pendingPhoto, setPendingPhoto] = useState<Record<string, boolean>>({});
  const [uploadingPhoto, setUploadingPhoto] = useState<string | null>(null);

  const loadChildData = useCallback(async (stuList: StudentRow[]) => {
    const ids = stuList.map((s) => s.id);
    // 4 queries in parallel — the old for-of loop did 2 * children serially.
    const [feesRes, paysRes, attRes, pendingRes] = await Promise.all([
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
      ids.length
        ? supabase.from("student_photo_submissions").select("student_id").in("student_id", ids).eq("status", "pending")
        : Promise.resolve({ data: [] }),
    ]);
    setFees((feesRes.data as FeeRow[]) ?? []);
    const pendingMap: Record<string, boolean> = {};
    for (const row of ((pendingRes.data as { student_id: string }[] | null) ?? [])) {
      pendingMap[row.student_id] = true;
    }
    setPendingPhoto(pendingMap);

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

  async function handlePhotoUpload(studentId: string, file: File) {
    if (!orgId) return;
    setUploadingPhoto(studentId);
    try {
      const photoUrl = await uploadProfilePhoto(orgId, "students", studentId, file);
      const { error } = await supabase.rpc("submit_student_photo", { p_student_id: studentId, p_photo_url: photoUrl });
      if (error) throw new Error(error.message);
      notify("Photo submitted — an admin will review it shortly.");
      setPendingPhoto((prev) => ({ ...prev, [studentId]: true }));
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not submit photo.", "error");
    } finally {
      setUploadingPhoto(null);
    }
  }

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
      <PageHeader
        icon={<Users size={24} />}
        gradient="emerald" title="My Children" subtitle="View your children's fees, payments, attendance, and results" />
      <ToastHost />

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
          <CardContent className="py-4 flex flex-col items-center text-center gap-2">
            {activeChild.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={activeChild.photo_url} alt={activeChild.full_name} className="h-14 w-14 rounded-full object-cover border-2 border-[#C9A227]" />
            ) : (
              <div className="h-14 w-14 rounded-full flex items-center justify-center text-lg font-bold text-white bg-gradient-to-br from-[#0F2A47] to-[#C9A227]">
                {activeChild.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
              </div>
            )}
            <div className="text-lg font-bold text-[#0F2A47]">{activeChild.full_name}</div>
            <div className="text-xs text-gray-500">{activeChild.student_code} · {activeChild.grade || "—"}</div>
            {pendingPhoto[activeChild.id] ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 font-medium">
                <Clock size={11} /> Photo pending review
              </span>
            ) : (
              <label>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handlePhotoUpload(activeChild.id, e.target.files[0])}
                />
                <span className="inline-flex items-center gap-1 text-[11px] text-[#0F2A47] hover:text-[#C9A227] cursor-pointer font-medium">
                  <Camera size={12} /> {uploadingPhoto === activeChild.id ? "Uploading…" : activeChild.photo_url ? "Change photo" : "Upload photo"}
                </span>
              </label>
            )}
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
