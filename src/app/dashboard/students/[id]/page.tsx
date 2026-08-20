"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fmtMoney, fmtDate, cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { LoadingSpinner } from "@/components/ui/PageHeader";
import { ChevronLeft, Phone, Mail, MapPin, Calendar } from "lucide-react";
import Link from "next/link";
import type { Student, IncomeEntry, FeeSchedule } from "@/lib/types";

export default function StudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();
  const [student, setStudent] = useState<Student | null>(null);
  const [history, setHistory] = useState<IncomeEntry[]>([]);
  const [fees, setFees] = useState<FeeSchedule[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [studRes, histRes, feeRes] = await Promise.all([
      supabase.from("students").select("*").eq("id", id).single(),
      supabase.from("income_entries").select("*").eq("student_id", id).order("date", { ascending: false }),
      supabase.from("fee_schedules").select("*").eq("active", true),
    ]);
    setStudent(studRes.data);
    setHistory(histRes.data ?? []);
    setFees(feeRes.data ?? []);
    setLoading(false);
  }, [id, supabase]);

  useEffect(() => { load(); }, [load]);

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
        </div>
      </div>
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
