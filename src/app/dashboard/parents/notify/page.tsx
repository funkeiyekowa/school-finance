"use client";

/**
 * Parent notifications hub.
 *
 * Composes a message once, personalises it per recipient using
 * placeholders ({guardian}, {student}, {grade}, {balance}), filters the
 * parent list by grade / class / payment status, and offers three
 * delivery paths:
 *   • Copy all phone numbers to the clipboard (feeds any bulk-SMS
 *     gateway or WhatsApp broadcast)
 *   • Download a CSV (phone, guardian, message)
 *   • Open a printable notice per family (per parent-facing letterhead)
 *
 * Uses the existing AI infra for the "Ask AI" polish button on the
 * message body so a bursar can turn one line into a warm, on-brand
 * note.
 */

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useBranding } from "@/lib/hooks/useBranding";
import { fmtMoney } from "@/lib/utils";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { AiAssistButton } from "@/components/ai/AiAssistButton";
import { MessageCircle, Copy, Download, Check, Send, Users, Printer } from "lucide-react";

interface Student {
  id: string; student_code: string; full_name: string; grade: string | null;
  guardian_name: string | null; guardian_phone: string | null; guardian_email: string | null;
}
interface Charge { student_id: string; amount: number; }

const DEFAULT_TEMPLATE = "Dear {guardian}, kindly note that {student} ({grade}) has an outstanding fee balance of {balance}. Please arrange payment at your earliest convenience. Thank you.";

export default function ParentNotifyPage() {
  const supabase = useMemo(() => createClient(), []);
  const { orgId } = useAuth();
  const branding = useBranding();

  const [students, setStudents] = useState<Student[]>([]);
  const [payments, setPayments] = useState<Charge[]>([]);
  const [fees, setFees] = useState<{ amount: number; grade: string | null }[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterGrade, setFilterGrade] = useState("");
  const [filterStatus, setFilterStatus] = useState<"" | "owing" | "paid" | "all">("owing");
  const [message, setMessage] = useState(DEFAULT_TEMPLATE);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    (async () => {
      const [sRes, pRes, fRes] = await Promise.all([
        supabase.from("students").select("id, student_code, full_name, grade, guardian_name, guardian_phone, guardian_email").eq("status", "active"),
        supabase.from("income_entries").select("student_id, amount"),
        supabase.from("fee_schedules").select("amount, grade").eq("active", true),
      ]);
      setStudents((sRes.data as Student[]) ?? []);
      setPayments((pRes.data as Charge[]) ?? []);
      setFees((fRes.data as { amount: number; grade: string | null }[]) ?? []);
      setLoading(false);
    })();
  }, [supabase, orgId]);

  const grades = useMemo(
    () => Array.from(new Set(students.map((s) => s.grade).filter(Boolean))).sort() as string[],
    [students]
  );

  // Compute per-student balance
  const balanceByStudent = useMemo(() => {
    const paid: Record<string, number> = {};
    payments.forEach((p) => { paid[p.student_id] = (paid[p.student_id] ?? 0) + p.amount; });
    const m = new Map<string, number>();
    students.forEach((s) => {
      const due = fees.filter((f) => !f.grade || f.grade === s.grade).reduce((sum, f) => sum + f.amount, 0);
      m.set(s.id, due - (paid[s.id] ?? 0));
    });
    return m;
  }, [students, payments, fees]);

  const filtered = students.filter((s) => {
    if (filterGrade && s.grade !== filterGrade) return false;
    const bal = balanceByStudent.get(s.id) ?? 0;
    if (filterStatus === "owing" && bal <= 0) return false;
    if (filterStatus === "paid" && bal > 0) return false;
    return !!s.guardian_phone; // must have a phone number to notify
  });

  function personalise(s: Student): string {
    const bal = balanceByStudent.get(s.id) ?? 0;
    return message
      .replace(/\{guardian\}/g, s.guardian_name ?? "Parent")
      .replace(/\{student\}/g, s.full_name)
      .replace(/\{grade\}/g, s.grade ?? "—")
      .replace(/\{balance\}/g, fmtMoney(Math.max(0, bal)))
      .replace(/\{school\}/g, branding?.schoolName ?? "");
  }

  async function copyPhones() {
    const phones = filtered.map((s) => s.guardian_phone).filter(Boolean).join(", ");
    try {
      await navigator.clipboard.writeText(phones);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked */ }
  }

  function downloadCsv() {
    const rows = ["phone,guardian,student,grade,balance,message"];
    filtered.forEach((s) => {
      const bal = balanceByStudent.get(s.id) ?? 0;
      const msg = personalise(s).replace(/"/g, '""');
      rows.push([
        s.guardian_phone ?? "",
        (s.guardian_name ?? "").replace(/"/g, '""'),
        s.full_name.replace(/"/g, '""'),
        s.grade ?? "",
        String(Math.max(0, bal)),
        `"${msg}"`,
      ].join(","));
    });
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `parent-notifications-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading || !branding) return <div className="p-6"><LoadingSpinner /></div>;

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        icon={<MessageCircle size={24} />}
        gradient="emerald"
        title="Parent Notifications"
        subtitle="Compose a personalised message and reach every relevant parent at once."
      />

      {/* Filters + counts */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Grade / Class</label>
              <select value={filterGrade} onChange={(e) => setFilterGrade(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm min-w-[160px]">
                <option value="">All grades</option>
                {grades.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Payment status</label>
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="owing">Owing (default)</option>
                <option value="paid">Fully paid</option>
                <option value="all">All parents</option>
              </select>
            </div>
            <div className="ml-auto flex items-center gap-2 text-sm">
              <Users size={16} className="text-gray-400" />
              <strong className="text-[#0F2A47]">{filtered.length}</strong>
              <span className="text-gray-500">will receive this message</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Message composer */}
      <Card>
        <CardContent className="py-4 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-semibold text-[#0F2A47]">Message</label>
            <AiAssistButton
              kinds={["polish", "shorten", "rewrite_positive", "sms_reminder"]}
              currentValue={message}
              onApply={(t) => setMessage(t)}
              source="parent_notify"
              label="Ask AI"
              compact
            />
          </div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="w-full h-32 p-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
            placeholder="Compose a warm, brief note. Placeholders: {guardian}, {student}, {grade}, {balance}, {school}"
          />
          <p className="text-xs text-gray-500">
            Placeholders: <code className="bg-gray-100 px-1 rounded">{"{guardian}"}</code>{" "}
            <code className="bg-gray-100 px-1 rounded">{"{student}"}</code>{" "}
            <code className="bg-gray-100 px-1 rounded">{"{grade}"}</code>{" "}
            <code className="bg-gray-100 px-1 rounded">{"{balance}"}</code>{" "}
            <code className="bg-gray-100 px-1 rounded">{"{school}"}</code>
          </p>
        </CardContent>
      </Card>

      {/* Preview */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-[#0F2A47]">Preview ({filtered.length} recipients)</h3>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={copyPhones} disabled={filtered.length === 0}>
                {copied ? <><Check size={13} className="text-emerald-600" /> Copied</> : <><Copy size={13} /> Copy phone numbers</>}
              </Button>
              <Button size="sm" variant="secondary" onClick={downloadCsv} disabled={filtered.length === 0}>
                <Download size={13} /> Download CSV
              </Button>
              <a
                href={filtered.length > 0 ? `https://wa.me/${filtered[0].guardian_phone?.replace(/[^+0-9]/g, "")}?text=${encodeURIComponent(personalise(filtered[0]))}` : "#"}
                target="_blank"
                rel="noopener"
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${filtered.length === 0 ? "opacity-40 pointer-events-none border-gray-200 text-gray-400" : "border-emerald-600 text-emerald-700 hover:bg-emerald-50"}`}
                title="Open WhatsApp with the first recipient's message pre-filled — good for spot-checking before sending"
              >
                <Send size={13} /> Send first via WhatsApp
              </a>
            </div>
          </div>
          {filtered.length === 0 ? (
            <p className="text-sm text-gray-500 italic py-6 text-center">
              No parents match this filter — try loosening it or add guardian phone numbers to students.
            </p>
          ) : (
            <div className="max-h-96 overflow-y-auto space-y-2 border border-gray-100 rounded-lg p-2 bg-gray-50">
              {filtered.map((s) => {
                const bal = balanceByStudent.get(s.id) ?? 0;
                return (
                  <div key={s.id} className="bg-white rounded-lg p-3 border border-gray-100 text-sm">
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <div>
                        <p className="font-semibold text-[#0F2A47]">{s.guardian_name ?? "—"}</p>
                        <p className="text-xs text-gray-500">
                          For {s.full_name} ({s.grade ?? "—"})
                          {s.guardian_phone && <> · {s.guardian_phone}</>}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {bal > 0 && <span className="text-xs font-semibold text-amber-700">{fmtMoney(bal)} owing</span>}
                        <button
                          onClick={() => window.open(`/dashboard/students/${s.id}/admission-letter`, "_blank")}
                          className="text-xs text-[#0F2A47] hover:text-[#C9A227] flex items-center gap-1"
                          title="Open a printable letter for this family"
                        >
                          <Printer size={11} />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-gray-700 whitespace-pre-wrap italic">{personalise(s)}</p>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-gray-500 italic">
        Tip: paste the copied numbers into your school&apos;s SMS gateway or a WhatsApp broadcast list.
        The CSV lets you feed a provider that accepts one row per recipient (phone, guardian, personalised message).
      </p>
    </div>
  );
}
