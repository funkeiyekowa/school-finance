"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtMoney, fmtDateTime, cn } from "@/lib/utils";
import { PageHeader, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { StatusBadge } from "@/components/ui/Badge";
import { BulkDeleteBar, RowCheckbox } from "@/components/ui/BulkDeleteBar";
import { useBulkSelect } from "@/lib/hooks/useBulkSelect";
import { MessageSquare, Search, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import type { SmsInbox, Student, FeeSchedule } from "@/lib/types";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { generateCode } from "@/lib/utils";

type AlertStatus = "all" | "needs_review" | "matched" | "unmatched" | "duplicate" | "rejected";

export default function SmsAlertsPage() {
  const { profile, canEdit, isDeveloper } = useAuth();
  const supabase = createClient();
  const [alerts, setAlerts] = useState<SmsInbox[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [fees, setFees] = useState<FeeSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<AlertStatus>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SmsInbox | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [alertRes, studRes, feeRes] = await Promise.all([
      supabase.from("sms_inbox").select("*").order("received_at", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("students").select("*").eq("status", "active").order("full_name"),
      supabase.from("fee_schedules").select("*").eq("active", true),
    ]);
    setAlerts(alertRes.data ?? []);
    setStudents(studRes.data ?? []);
    setFees(feeRes.data ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const filtered = alerts.filter(a => {
    const matchStatus = filterStatus === "all" || a.match_status === filterStatus;
    const q = search.toLowerCase();
    const matchQ = !q ||
      (a.parsed_student_number || "").toLowerCase().includes(q) ||
      (a.parsed_student_name || "").toLowerCase().includes(q) ||
      (a.sender || "").toLowerCase().includes(q) ||
      a.message_text.toLowerCase().includes(q);
    return matchStatus && matchQ;
  });

  const counts = {
    total: alerts.length,
    needs_review: alerts.filter(a => a.match_status === "needs_review").length,
    matched: alerts.filter(a => a.match_status === "matched").length,
    unmatched: alerts.filter(a => a.match_status === "unmatched").length,
    duplicate: alerts.filter(a => a.match_status === "duplicate").length,
    rejected: alerts.filter(a => a.match_status === "rejected").length,
  };

  // Bulk delete (developer only)
  const { selectedIds, toggle: toggleSelect, selectAll, clearSelection } = useBulkSelect(filtered.map(a => a.id));

  async function bulkDeleteSelected(ids: string[]) {
    for (const id of ids) { await supabase.from("sms_inbox").delete().eq("id", id); }
    await supabase.from("activity_log").insert({ user_email: profile?.email, user_name: profile?.full_name, action: "Bulk Delete SMS Alerts", details: `${ids.length} alerts deleted` });
    load();
  }
  async function bulkDeleteAll() {
    await supabase.from("sms_inbox").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("activity_log").insert({ user_email: profile?.email, user_name: profile?.full_name, action: "Purge All SMS Alerts", details: "All SMS alerts deleted" });
    load();
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Payment Alerts" subtitle="Bank SMS alerts — income (CR) and expenses (DR) from your school account">
        {process.env.NODE_ENV !== "production" && (
          <TestSMSButton onInserted={load} />
        )}
      </PageHeader>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Total", value: counts.total, status: "all" as AlertStatus, color: "text-[#0F2A47]" },
          { label: "Needs Review", value: counts.needs_review, status: "needs_review" as AlertStatus, color: "text-amber-700" },
          { label: "Matched", value: counts.matched, status: "matched" as AlertStatus, color: "text-green-700" },
          { label: "Unmatched", value: counts.unmatched, status: "unmatched" as AlertStatus, color: "text-gray-600" },
          { label: "Duplicate", value: counts.duplicate, status: "duplicate" as AlertStatus, color: "text-purple-700" },
          { label: "Rejected", value: counts.rejected, status: "rejected" as AlertStatus, color: "text-red-700" },
        ].map(item => (
          <button key={item.status}
            onClick={() => setFilterStatus(item.status)}
            className={cn(
              "bg-white rounded-xl border p-4 text-left transition-all hover:border-[#C9A227]",
              filterStatus === item.status && "border-[#C9A227] ring-1 ring-[#C9A227]"
            )}>
            <div className="text-xs text-gray-500 mb-1">{item.label}</div>
            <div className={cn("text-xl font-bold", item.color)}>{item.value}</div>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input type="text" placeholder="Search by student number, name, sender…"
          value={search} onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]" />
      </div>

      {loading ? <LoadingSpinner /> : (
        <>
          <BulkDeleteBar selectedIds={selectedIds} totalCount={filtered.length} itemLabel="SMS alerts"
            onDeleteSelected={bulkDeleteSelected} onDeleteAll={bulkDeleteAll}
            onSelectAll={selectAll} onClearSelection={clearSelection} isDeveloper={isDeveloper} />
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#0F2A47] text-white">
                  {isDeveloper && <th className="w-8 px-2 py-3" />}
                  <th className="text-left px-4 py-3 text-xs font-semibold">Type</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Received</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Code</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Student / Vendor</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold">Amount</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Reason</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Confidence</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={isDeveloper ? 10 : 9}><EmptyState message="No SMS alerts found." icon={<MessageSquare size={32} />} /></td></tr>
                ) : (
                  filtered.map(alert => {
                    const isExpense = alert.parser_version === "v3-expense";
                    return (
                    <tr key={alert.id}
                      className={cn("border-b border-gray-50 hover:bg-gray-50 cursor-pointer", alert.match_status === "needs_review" && "bg-amber-50/30")}
                      onClick={() => setSelected(alert)}>
                      <RowCheckbox id={alert.id} selectedIds={selectedIds} onToggle={toggleSelect} isDeveloper={isDeveloper} />
                      <td className="px-4 py-3">
                        <span className={cn(
                          "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold",
                          isExpense ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
                        )}>
                          {isExpense ? "↑ Expense" : "↓ Income"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{fmtDateTime(alert.received_at || alert.created_at)}</td>
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-[#0F2A47]">{alert.parsed_student_number || "—"}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{alert.parsed_student_name || "—"}</div>
                        <div className="text-xs text-gray-400">{isExpense ? "Vendor / Payee" : "Student"}</div>
                      </td>
                      <td className={cn("px-4 py-3 text-right font-bold", isExpense ? "text-red-700" : "text-green-700")}>
                        {alert.parsed_amount ? (isExpense ? "-" : "+") + fmtMoney(alert.parsed_amount) : "—"}
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={alert.match_status} /></td>
                      <td className="px-4 py-3 text-xs text-gray-500 max-w-[220px]">
                        <span className="line-clamp-2">{alert.match_reason || "—"}</span>
                      </td>
                      <td className="px-4 py-3">
                        {alert.confidence_score != null ? (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-gray-100 rounded-full w-12">
                              <div className="h-full rounded-full bg-[#C9A227]"
                                style={{ width: `${(alert.confidence_score * 100).toFixed(0)}%` }} />
                            </div>
                            <span className="text-xs text-gray-500">{(alert.confidence_score * 100).toFixed(0)}%</span>
                          </div>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {alert.match_status === "needs_review" && (
                          <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
                            <AlertTriangle size={12} /> Review
                          </span>
                        )}
                        {alert.match_status === "matched" && (
                          <span className="flex items-center gap-1 text-xs text-green-600">
                            <CheckCircle size={12} /> Done
                          </span>
                        )}
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
        </>
      )}

      {selected && (
        <AlertDetailModal
          alert={selected}
          students={students}
          fees={fees}
          onClose={() => { setSelected(null); load(); }}
        />
      )}
    </div>
  );
}

function AlertDetailModal({
  alert, students, fees, onClose,
}: { alert: SmsInbox; students: Student[]; fees: FeeSchedule[]; onClose: () => void }) {
  const supabase = createClient();
  const { profile } = useAuth();
  const [action, setAction] = useState<"view" | "approve" | "reject" | "duplicate">("view");
  const [reviewNote, setReviewNote] = useState("");
  const [editAmount, setEditAmount] = useState(String(alert.parsed_amount || ""));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [vendors, setVendors] = useState<{ id: string; name: string; vendor_code: string; category: string | null }[]>([]);

  // Detect type
  const isExpense = alert.parser_version === "v3-expense";

  // For income: student selection
  const [selectedStudentId, setSelectedStudentId] = useState(alert.matched_student_id || "");
  const [selectedFeeId, setSelectedFeeId] = useState(alert.matched_fee_id || "");

  // For expense: vendor selection + category
  const [selectedVendorId, setSelectedVendorId] = useState("");
  const [expenseCategory, setExpenseCategory] = useState("Other Expense");

  const selectedStudent = students.find(s => s.id === selectedStudentId);
  const studentOptions = students.map(s => ({ value: s.id, label: s.full_name, sublabel: s.student_code }));
  const feeOptions = [
    { value: "", label: "No specific fee" },
    ...fees.filter(f => !selectedStudent?.grade || !f.grade || f.grade === selectedStudent.grade)
      .map(f => ({ value: f.id, label: f.name, sublabel: `${fmtMoney(f.amount)} · ${f.category}` })),
  ];

  const vendorOptions = vendors.map(v => ({ value: v.id, label: v.name, sublabel: v.vendor_code + (v.category ? ` · ${v.category}` : "") }));
  const expenseCategoryOptions = [
    "Rent", "Utilities", "Salaries & Wages", "Teaching Supplies & Materials",
    "Maintenance & Repairs", "Transport", "Textbook Purchases",
    "Administrative & Office", "Insurance", "Other Expense",
  ].map(c => ({ value: c, label: c }));

  // Load vendors when action is approve and this is an expense
  useEffect(() => {
    if (isExpense && action === "approve") {
      supabase.from("vendors").select("id, name, vendor_code, category").order("name").then(({ data }) => {
        setVendors(data ?? []);
      });
    }
  }, [isExpense, action, supabase]);

  async function runAction() {
    setLoading(true);
    setError("");
    try {
      if (action === "approve") {
        if (!editAmount || isNaN(parseFloat(editAmount)) || parseFloat(editAmount) <= 0) {
          setError("Enter a valid positive amount."); setLoading(false); return;
        }

        if (isExpense) {
          // ========== EXPENSE APPROVAL ==========
          // Generate voucher number
          const { data: existing } = await supabase.from("expense_entries").select("voucher_no");
          const voucherNo = generateCode("VCH-", (existing ?? []).map(e => e.voucher_no));
          const selectedVendor = vendors.find(v => v.id === selectedVendorId);

          await supabase.from("expense_entries").insert({
            voucher_no: voucherNo,
            date: (alert.received_at || alert.created_at).substring(0, 10),
            vendor_id: selectedVendorId || null,
            vendor_name: selectedVendor?.name || alert.parsed_student_name || "Unknown",
            category: expenseCategory,
            description: `Bank DR Alert — ${alert.parsed_reference || "Manual approval"}`,
            amount: parseFloat(editAmount),
            payment_method: "Bank Transfer",
            approved_by: profile?.full_name || profile?.email,
            reconciled: false,
            notes: reviewNote || null,
          });

          await supabase.from("sms_inbox").update({
            match_status: "matched",
            processing_status: "confirmed",
            review_notes: reviewNote || null,
            reviewed_by: profile?.id,
            reviewed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq("id", alert.id);

          await supabase.from("activity_log").insert({
            user_email: profile?.email, user_name: profile?.full_name,
            action: "Approve Expense Alert",
            details: `${voucherNo} — ${selectedVendor?.name || alert.parsed_student_name} — ${fmtMoney(parseFloat(editAmount))} — ${expenseCategory}`,
          });

        } else {
          // ========== INCOME APPROVAL (student payment) ==========
          if (!selectedStudentId) { setError("Select a student to apply the payment."); setLoading(false); return; }

          const { data: existing } = await supabase.from("income_entries").select("receipt_no");
          const receiptNo = generateCode("RCT-", (existing ?? []).map(e => e.receipt_no));

          await supabase.from("income_entries").insert({
            receipt_no: receiptNo,
            date: (alert.received_at || alert.created_at).substring(0, 10),
            student_id: selectedStudentId,
            student_name: selectedStudent?.full_name,
            category: "School Fees",
            description: `SMS Payment — Ref: ${alert.parsed_reference || "—"}`,
            amount: parseFloat(editAmount),
            payment_method: "Bank Transfer",
            term: null,
            recorded_by: profile?.full_name || profile?.email,
            reconciled: false,
            payment_source: "smsgate_sms",
            sms_inbox_id: alert.id,
            notes: reviewNote || null,
          });

          await supabase.from("sms_inbox").update({
            match_status: "matched",
            processing_status: "confirmed",
            matched_student_id: selectedStudentId,
            matched_fee_id: selectedFeeId || null,
            review_notes: reviewNote || null,
            reviewed_by: profile?.id,
            reviewed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq("id", alert.id);

          await supabase.from("activity_log").insert({
            user_email: profile?.email, user_name: profile?.full_name,
            action: "Approve SMS Payment",
            details: `${receiptNo} — ${selectedStudent?.full_name} — ${fmtMoney(parseFloat(editAmount))}`,
          });
        }

      } else if (action === "reject") {
        if (!reviewNote.trim()) { setError("A review note is required to reject."); setLoading(false); return; }
        await supabase.from("sms_inbox").update({
          match_status: "rejected", processing_status: "rejected",
          review_notes: reviewNote, reviewed_by: profile?.id,
          reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).eq("id", alert.id);
        await supabase.from("activity_log").insert({
          user_email: profile?.email, user_name: profile?.full_name,
          action: isExpense ? "Reject Expense Alert" : "Reject SMS Payment", details: `${alert.id} — ${reviewNote}`,
        });

      } else if (action === "duplicate") {
        await supabase.from("sms_inbox").update({
          match_status: "duplicate", processing_status: "duplicate",
          review_notes: reviewNote || "Marked as duplicate", reviewed_by: profile?.id,
          reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).eq("id", alert.id);
        await supabase.from("activity_log").insert({
          user_email: profile?.email, user_name: profile?.full_name,
          action: "Mark Duplicate", details: alert.id,
        });
      }

      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An error occurred.");
      setLoading(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={isExpense ? "Expense Alert Details" : "Payment Alert Details"} size="xl">
      <div className="space-y-4">
        {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}

        {/* Type badge */}
        <div className={cn("inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold", isExpense ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700")}>
          {isExpense ? "↑ Expense (Debit)" : "↓ Income (Credit)"}
        </div>

        {/* SMS text */}
        <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
          <div className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Original SMS</div>
          <p className="text-sm text-gray-800 font-medium leading-relaxed">{alert.message_text}</p>
          <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
            <span>From: <strong>{alert.sender || "—"}</strong></span>
            <span>{fmtDateTime(alert.received_at || alert.created_at)}</span>
          </div>
        </div>

        {/* System comment */}
        {alert.match_reason && (
          <div className={cn("rounded-xl p-4 border text-sm",
            alert.match_status === "matched" ? "bg-green-50 border-green-200 text-green-800" :
            alert.match_status === "duplicate" ? "bg-purple-50 border-purple-200 text-purple-800" :
            alert.match_status === "rejected" ? "bg-red-50 border-red-200 text-red-800" :
            "bg-amber-50 border-amber-200 text-amber-800"
          )}>
            <div className="text-xs font-semibold uppercase tracking-wide opacity-70 mb-1">System Comment</div>
            <p className="font-medium">{alert.match_reason}</p>
          </div>
        )}

        {/* Parsed data — context-aware labels */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {isExpense ? (
            <>
              <div className="bg-white border border-gray-100 rounded-lg p-3">
                <div className="text-xs text-gray-400 mb-1">Vendor / Payee</div>
                <div className="text-sm font-semibold text-gray-800">{alert.parsed_student_name || "—"}</div>
              </div>
              <div className="bg-white border border-gray-100 rounded-lg p-3">
                <div className="text-xs text-gray-400 mb-1">Amount (Debit)</div>
                <div className="text-sm font-semibold text-red-700">{alert.parsed_amount ? fmtMoney(alert.parsed_amount) : "—"}</div>
              </div>
              <div className="bg-white border border-gray-100 rounded-lg p-3">
                <div className="text-xs text-gray-400 mb-1">Reference</div>
                <div className="text-sm font-semibold text-gray-800">{alert.parsed_reference || "—"}</div>
              </div>
            </>
          ) : (
            <>
              <div className="bg-white border border-gray-100 rounded-lg p-3">
                <div className="text-xs text-gray-400 mb-1">Student No.</div>
                <div className="text-sm font-semibold text-gray-800">{alert.parsed_student_number || "—"}</div>
              </div>
              <div className="bg-white border border-gray-100 rounded-lg p-3">
                <div className="text-xs text-gray-400 mb-1">Student Name</div>
                <div className="text-sm font-semibold text-gray-800">{alert.parsed_student_name || "—"}</div>
              </div>
              <div className="bg-white border border-gray-100 rounded-lg p-3">
                <div className="text-xs text-gray-400 mb-1">Amount (Credit)</div>
                <div className="text-sm font-semibold text-green-700">{alert.parsed_amount ? fmtMoney(alert.parsed_amount) : "—"}</div>
              </div>
              <div className="bg-white border border-gray-100 rounded-lg p-3">
                <div className="text-xs text-gray-400 mb-1">Reference</div>
                <div className="text-sm font-semibold text-gray-800">{alert.parsed_reference || "—"}</div>
              </div>
            </>
          )}
          <div className="bg-white border border-gray-100 rounded-lg p-3">
            <div className="text-xs text-gray-400 mb-1">Match Status</div>
            <StatusBadge status={alert.match_status} />
          </div>
        </div>

        {/* Confidence */}
        {alert.confidence_score != null && (
          <div className="flex items-center gap-3 bg-white border border-gray-100 rounded-lg p-3">
            <span className="text-xs text-gray-500 font-medium">Confidence:</span>
            <div className="flex-1 h-2 bg-gray-100 rounded-full">
              <div className="h-full rounded-full bg-[#C9A227]" style={{ width: `${(alert.confidence_score * 100).toFixed(0)}%` }} />
            </div>
            <span className="text-sm font-bold text-[#0F2A47]">{(alert.confidence_score * 100).toFixed(0)}%</span>
          </div>
        )}

        {/* APPROVE FORM — different for income vs expense */}
        {action === "approve" && (
          <div className="space-y-3 bg-[#FBF6E8] border border-[#F4E9C7] rounded-xl p-4">
            <div className="text-sm font-semibold text-[#0F2A47]">
              {isExpense ? "Record Expense To" : "Assign Payment To"}
            </div>

            {isExpense ? (
              <>
                <SearchableSelect label="Vendor / Payee" options={vendorOptions} value={selectedVendorId} onChange={setSelectedVendorId} placeholder="Select vendor (optional — will use parsed name if blank)…" />
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Expense Category</label>
                  <select value={expenseCategory} onChange={e => setExpenseCategory(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white">
                    {expenseCategoryOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <Input label="Amount (₦)" type="number" value={editAmount} onChange={e => setEditAmount(e.target.value)} min="0" step="0.01" />
              </>
            ) : (
              <>
                <SearchableSelect label="Student" options={studentOptions} value={selectedStudentId} onChange={setSelectedStudentId} placeholder="Select student…" />
                <SearchableSelect label="Fee / Invoice (optional)" options={feeOptions} value={selectedFeeId} onChange={setSelectedFeeId} placeholder="No specific fee" />
                <Input label="Amount (₦)" type="number" value={editAmount} onChange={e => setEditAmount(e.target.value)} min="0" step="0.01" />
              </>
            )}
          </div>
        )}

        {/* Review note */}
        {(action === "reject" || action === "duplicate" || action === "approve") && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Review Note {action === "reject" ? "(required)" : "(optional)"}
            </label>
            <textarea value={reviewNote} onChange={e => setReviewNote(e.target.value)} rows={2}
              placeholder="Add a note about this decision…"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] resize-none" />
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
          {action === "view" ? (
            <>
              {alert.match_status !== "matched" && alert.match_status !== "rejected" && alert.match_status !== "duplicate" && (
                <>
                  <Button variant="gold" size="sm" onClick={() => setAction("approve")}>
                    <CheckCircle size={13} /> {isExpense ? "Approve & Record Expense" : "Approve & Apply Payment"}
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => setAction("reject")}>
                    <XCircle size={13} /> Reject
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setAction("duplicate")}>
                    Mark Duplicate
                  </Button>
                </>
              )}
              <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
            </>
          ) : (
            <>
              <Button variant="gold" loading={loading} onClick={runAction}>
                {action === "approve"
                  ? (isExpense ? "Confirm & Record Expense" : "Confirm & Apply Payment")
                  : action === "reject" ? "Confirm Rejection" : "Confirm Duplicate"}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => { setAction("view"); setError(""); }}>
                Cancel
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function TestSMSButton({ onInserted }: { onInserted: () => void }) {
  const supabase = createClient();
  const [loading, setLoading] = useState(false);

  const samples = [
    { message_text: "Payment received. Student No: STU-0001. Name: Ada Okafor. Amount: NGN 250,000. Ref: TXN893421.", parsed_student_number: "STU-0001", parsed_student_name: "Ada Okafor", parsed_amount: 250000, parsed_reference: "TXN893421", confidence_score: 0.95, match_status: "needs_review" },
    { message_text: "₦75,000 received for student 2026001 - Chinedu Obi. Transaction ID: 123456789.", parsed_student_number: "2026001", parsed_student_name: "Chinedu Obi", parsed_amount: 75000, parsed_reference: "123456789", confidence_score: 0.80, match_status: "needs_review" },
    { message_text: "School fees payment of N150000 for Admission No SS2/001, Student: Fatima Bello, Ref PAY-2026-999.", parsed_student_number: "SS2/001", parsed_student_name: "Fatima Bello", parsed_amount: 150000, parsed_reference: "PAY-2026-999", confidence_score: 0.85, match_status: "needs_review" },
  ];

  async function insertSample() {
    setLoading(true);
    const sample = samples[Math.floor(Math.random() * samples.length)];
    await supabase.from("sms_inbox").insert({
      message_text: sample.message_text,
      event_id: `test-${Date.now()}`,
      message_id: `msg-${Date.now()}`,
      sender: "+234800" + Math.floor(Math.random() * 9000000 + 1000000),
      received_at: new Date().toISOString(),
      parsed_student_number: sample.parsed_student_number,
      parsed_student_name: sample.parsed_student_name,
      parsed_amount: sample.parsed_amount,
      parsed_currency: "NGN",
      parsed_reference: sample.parsed_reference,
      confidence_score: sample.confidence_score,
      processing_status: "received",
      match_status: sample.match_status as string,
      parser_version: "v1-test",
    });
    setLoading(false);
    onInserted();
  }

  return (
    <Button variant="secondary" size="sm" onClick={insertSample} loading={loading}>
      + Insert Test SMS
    </Button>
  );
}
