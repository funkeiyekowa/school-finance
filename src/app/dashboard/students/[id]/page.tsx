"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtMoney, fmtDate, cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/Badge";
import { LoadingSpinner } from "@/components/ui/PageHeader";
import { ChevronLeft, Phone, Mail, MapPin, Key, Printer, Copy, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import type { Student, IncomeEntry, FeeSchedule } from "@/lib/types";

interface EnrollmentWithDetails {
  id: string;
  class_name: string;
  year_name: string;
  status: string;
  enrolled_at: string;
}

interface LoginSlip {
  login_email: string;
  student_code: string;
  temporary_password: string;
}

export default function StudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();
  const { isAdmin } = useAuth();
  const [student, setStudent] = useState<Student | null>(null);
  const [history, setHistory] = useState<IncomeEntry[]>([]);
  const [fees, setFees] = useState<FeeSchedule[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollmentWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [loginSlip, setLoginSlip] = useState<LoginSlip | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [studRes, histRes, feeRes, enrRes, clsRes, yrRes] = await Promise.all([
      supabase.from("students").select("*").eq("id", id).single(),
      supabase.from("income_entries").select("*").eq("student_id", id).order("date", { ascending: false }),
      supabase.from("fee_schedules").select("*").eq("active", true),
      supabase.from("student_enrollments").select("*").eq("student_id", id).order("enrolled_at", { ascending: false }),
      supabase.from("classes").select("id, name"),
      supabase.from("academic_years").select("id, name"),
    ]);
    setStudent(studRes.data);
    setHistory(histRes.data ?? []);
    setFees(feeRes.data ?? []);

    // Join enrollments with class/year names
    const classMap = new Map((clsRes.data ?? []).map((c: { id: string; name: string }) => [c.id, c.name]));
    const yearMap = new Map((yrRes.data ?? []).map((y: { id: string; name: string }) => [y.id, y.name]));
    setEnrollments((enrRes.data ?? []).map((e: Record<string, unknown>) => ({
      id: String(e.id),
      class_name: classMap.get(String(e.class_id)) || "—",
      year_name: yearMap.get(String(e.academic_year_id)) || "—",
      status: String(e.status || "active"),
      enrolled_at: String(e.enrolled_at || e.created_at || ""),
    })));

    setLoading(false);
  }, [id, supabase]);

  useEffect(() => { load(); }, [load]);

  async function resetLogin() {
    if (!student) return;
    if (!confirm(`Generate a new temporary password for ${student.full_name}? Their existing password will stop working immediately.`)) return;
    setResetting(true);
    const { data, error } = await supabase.rpc("reset_student_password", { p_student: student.id });
    setResetting(false);
    if (error) { alert(`Failed to reset password: ${error.message}`); return; }
    const res = data as { ok: boolean; login_email: string; student_code: string; temporary_password: string } | null;
    if (!res?.ok) { alert("Password reset was rejected."); return; }
    setLoginSlip({
      login_email: res.login_email,
      student_code: res.student_code,
      temporary_password: res.temporary_password,
    });
  }

  function copySlip() {
    if (!loginSlip || !student) return;
    const text =
      `${student.full_name} — login credentials\n` +
      `Student code: ${loginSlip.student_code}\n` +
      `Sign-in email: ${loginSlip.login_email}\n` +
      `Temporary password: ${loginSlip.temporary_password}\n` +
      `\nThe student will be asked to set a new password on their first sign-in.`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function printSlip() {
    if (!loginSlip || !student) return;
    const w = window.open("", "_blank", "width=520,height=640");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>Login slip — ${student.full_name}</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;padding:32px;color:#0F2A47;max-width:400px;margin:auto;}
h1{font-size:18px;margin-bottom:4px;}
.muted{color:#6b7280;font-size:12px;margin-bottom:24px;}
.row{padding:10px 0;border-bottom:1px solid #E5E7EB;display:flex;justify-content:space-between;}
.label{color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;}
.value{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:14px;font-weight:600;}
.note{margin-top:24px;padding:12px 14px;background:#FBF6E8;border-left:3px solid #C9A227;font-size:12px;color:#4b3f14;}
</style></head><body>
<h1>Login credentials — ${escapeHtml(student.full_name)}</h1>
<p class="muted">Please keep this slip safe. The temporary password is shown only once.</p>
<div class="row"><span class="label">Student code</span><span class="value">${escapeHtml(loginSlip.student_code)}</span></div>
<div class="row"><span class="label">Sign-in email</span><span class="value">${escapeHtml(loginSlip.login_email)}</span></div>
<div class="row"><span class="label">Temporary password</span><span class="value">${escapeHtml(loginSlip.temporary_password)}</span></div>
<div class="note">On first sign-in the student will be prompted to set a new password before continuing.</div>
</body></html>`);
    w.document.close();
    w.print();
  }

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;
  if (!student) return <div className="p-6 text-gray-500">Student not found.</div>;

  const totalDue = fees.filter(f => !f.grade || f.grade === student.grade).reduce((s, f) => s + f.amount, 0);
  const totalPaid = history.reduce((s, r) => s + r.amount, 0);
  const balance = totalDue - totalPaid;
  const paymentStatus = balance <= 0 ? "paid" : totalPaid > 0 ? "partial" : "unpaid";

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ChevronLeft size={16} /> Back to Students
        </button>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Student info */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{student.full_name}</CardTitle>
              <StatusBadge status={paymentStatus} />
            </div>
            <p className="text-xs text-gray-400 font-mono mt-1">{student.student_code}</p>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Grade" value={student.grade} />
            <Row label="Academic Year" value={student.academic_year} />
            <Row label="Gender" value={student.gender} />
            <Row label="Admission Date" value={fmtDate(student.admission_date)} />
            <Row label="Date of Birth" value={fmtDate(student.date_of_birth)} />
            {student.address && (
              <div className="flex items-start gap-2 pt-2 border-t border-gray-100">
                <MapPin size={14} className="text-gray-400 mt-0.5 shrink-0" />
                <span className="text-gray-600">{student.address}</span>
              </div>
            )}

            <div className="border-t border-gray-100 pt-3">
              <div className="text-xs font-semibold text-gray-500 uppercase mb-2">Guardian</div>
              <div className="font-medium text-gray-900">{student.guardian_name || "—"}</div>
              {student.guardian_phone && (
                <div className="flex items-center gap-2 mt-1">
                  <Phone size={12} className="text-gray-400" />
                  <span className="text-gray-600">{student.guardian_phone}</span>
                </div>
              )}
              {student.guardian_email && (
                <div className="flex items-center gap-2 mt-1">
                  <Mail size={12} className="text-gray-400" />
                  <span className="text-gray-600">{student.guardian_email}</span>
                </div>
              )}
            </div>

            {isAdmin && (
              <div className="border-t border-gray-100 pt-3">
                <div className="text-xs font-semibold text-gray-500 uppercase mb-2">Student Portal Login</div>
                <p className="text-xs text-gray-500 mb-3">
                  Reset the student&apos;s password to generate a new temporary
                  password you can print or read out to them. They will be
                  asked to set a new password on their next sign-in.
                </p>
                <Button size="sm" variant="secondary" loading={resetting} onClick={resetLogin}>
                  <Key size={13} /> Reset & Print Login
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Balance summary */}
        <div className="lg:col-span-2 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white rounded-xl border p-4">
              <div className="text-xs text-gray-500 mb-1">Total Due</div>
              <div className="text-xl font-bold text-[#0F2A47]">{fmtMoney(totalDue)}</div>
            </div>
            <div className="bg-white rounded-xl border p-4">
              <div className="text-xs text-gray-500 mb-1">Total Paid</div>
              <div className="text-xl font-bold text-green-700">{fmtMoney(totalPaid)}</div>
            </div>
            <div className="bg-white rounded-xl border p-4">
              <div className="text-xs text-gray-500 mb-1">Balance</div>
              <div className={cn("text-xl font-bold", balance > 0 ? "text-red-700" : "text-green-700")}>
                {fmtMoney(Math.abs(balance))}
                {balance < 0 && <span className="text-xs ml-1 font-normal">(credit)</span>}
              </div>
            </div>
          </div>

          {/* Applicable fees */}
          {fees.filter(f => !f.grade || f.grade === student.grade).length > 0 && (
            <Card>
              <CardHeader><CardTitle>Applicable Fee Schedule</CardTitle></CardHeader>
              <CardContent className="pt-0">
                {fees.filter(f => !f.grade || f.grade === student.grade).map(f => (
                  <div key={f.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                    <div>
                      <div className="text-sm font-medium">{f.name}</div>
                      <div className="text-xs text-gray-400">{f.category} {f.term ? `· ${f.term}` : ""}</div>
                    </div>
                    <div className="font-semibold text-sm">{fmtMoney(f.amount)}</div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Quick record payment */}
          <div className="flex gap-2">
            <Link href={`/dashboard/income?student=${student.id}`}>
              <Button variant="gold">Record Payment</Button>
            </Link>
          </div>

          {/* Payment history */}
          <Card>
            <CardHeader><CardTitle>Payment History</CardTitle></CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-600">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold">Receipt</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold">Date</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold">Category</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold">Method</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold">Amount</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold">Recon.</th>
                  </tr>
                </thead>
                <tbody>
                  {history.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-8 text-gray-400 text-sm">No payments recorded</td></tr>
                  ) : (
                    history.map(r => (
                      <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-4 py-2.5 font-mono text-xs font-semibold text-[#0F2A47]">{r.receipt_no}</td>
                        <td className="px-4 py-2.5 text-gray-600">{fmtDate(r.date)}</td>
                        <td className="px-4 py-2.5 text-gray-600">{r.category}</td>
                        <td className="px-4 py-2.5 text-gray-600">{r.payment_method}</td>
                        <td className="px-4 py-2.5 text-right font-semibold">{fmtMoney(r.amount)}</td>
                        <td className="px-4 py-2.5">
                          <span className={cn("inline-block w-2 h-2 rounded-full", r.reconciled ? "bg-green-500" : "bg-gray-300")} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Academic History */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Academic History</CardTitle>
                <Link href="/dashboard/students/promotion">
                  <Button size="sm" variant="gold">Promote / Demote Student</Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {enrollments.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">
                  No enrollment history. Use the Promotion Center to create enrollments.
                </p>
              ) : (
                <div className="space-y-2">
                  {enrollments.map((e, i) => (
                    <div key={e.id} className={cn(
                      "flex items-center justify-between p-3 rounded-lg border",
                      i === 0 ? "bg-[#FBF6E8] border-[#C9A227]" : "bg-white border-gray-100"
                    )}>
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                          i === 0 ? "bg-[#C9A227] text-white" : "bg-gray-100 text-gray-500"
                        )}>
                          {e.class_name.substring(0, 3)}
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-gray-900">{e.class_name}</div>
                          <div className="text-xs text-gray-500">{e.year_name}</div>
                        </div>
                      </div>
                      <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                        e.status === "active" ? "bg-green-100 text-green-700" :
                        e.status === "completed" ? "bg-blue-100 text-blue-600" :
                        e.status === "graduated" ? "bg-purple-100 text-purple-700" :
                        e.status === "repeated" ? "bg-amber-100 text-amber-700" :
                        e.status === "demoted" ? "bg-orange-100 text-orange-700" :
                        "bg-gray-100 text-gray-500"
                      )}>{e.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* One-time login-slip modal — shown after a successful reset. */}
      {loginSlip && (
        <Modal open onClose={() => setLoginSlip(null)} title="Temporary login credentials" size="md">
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Copy or print these details now. The temporary password will not be shown again.
            </p>
            <div className="rounded-lg border border-gray-200 bg-gray-50 divide-y divide-gray-200">
              <SlipRow label="Student code" value={loginSlip.student_code} mono />
              <SlipRow label="Sign-in email" value={loginSlip.login_email} mono />
              <SlipRow label="Temporary password" value={loginSlip.temporary_password} mono highlight />
            </div>
            <p className="text-xs text-gray-500">
              The student will be prompted to set a new password on their first sign-in.
            </p>
            <div className="flex gap-2 justify-end pt-2">
              <Button size="sm" variant="secondary" onClick={copySlip}>
                {copied ? <><CheckCircle2 size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
              </Button>
              <Button size="sm" variant="secondary" onClick={printSlip}>
                <Printer size={13} /> Print
              </Button>
              <Button size="sm" variant="gold" onClick={() => setLoginSlip(null)}>Done</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SlipRow({ label, value, mono, highlight }: { label: string; value: string; mono?: boolean; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5">
      <span className="text-xs text-gray-500 uppercase tracking-wide font-semibold">{label}</span>
      <span className={cn(
        "text-sm font-semibold",
        mono && "font-mono",
        highlight ? "text-[#C9A227]" : "text-[#0F2A47]"
      )}>{value}</span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between border-b border-gray-50 pb-2">
      <span className="text-gray-500 text-xs">{label}</span>
      <span className="font-medium text-gray-900 text-sm">{value}</span>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
