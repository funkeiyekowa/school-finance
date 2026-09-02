"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtMoney, fmtDate, today, exportCSV } from "@/lib/utils";
import { insertIncomeWithReceipt } from "@/lib/finance/numberedEntries";
import { PageHeader, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { Modal } from "@/components/ui/Modal";
import { BulkDeleteBar, RowCheckbox } from "@/components/ui/BulkDeleteBar";
import { useBulkSelect } from "@/lib/hooks/useBulkSelect";
import { useToast } from "@/lib/hooks/useToast";
import { cn } from "@/lib/utils";
import { Plus, Search, Download, Receipt, CheckCircle, Circle, TrendingUp } from "lucide-react";
import type { IncomeEntry, Student, FeeSchedule } from "@/lib/types";
import { INCOME_CATEGORIES, PAYMENT_METHODS } from "@/lib/types";

function IncomePageInner() {
  const searchParams = useSearchParams();
  const { canEdit, profile, isDeveloper } = useAuth();
  const supabase = createClient();
  const { notify, ToastHost } = useToast();
  const [entries, setEntries] = useState<IncomeEntry[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [fees, setFees] = useState<FeeSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterRecon, setFilterRecon] = useState("");
  const [defaultStudentId] = useState(searchParams.get("student") || "");

  const load = useCallback(async () => {
    setLoading(true);
    const [entRes, studRes, feeRes] = await Promise.all([
      supabase.from("income_entries").select("*").order("date", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("students").select("*").eq("status", "active").order("full_name"),
      supabase.from("fee_schedules").select("*").eq("active", true),
    ]);
    setEntries(entRes.data ?? []);
    setStudents(studRes.data ?? []);
    setFees(feeRes.data ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const filtered = entries.filter(e => {
    const q = search.toLowerCase();
    const matchQ = !q || e.receipt_no.toLowerCase().includes(q) || (e.student_name || "").toLowerCase().includes(q) || e.category.toLowerCase().includes(q);
    const matchCat = !filterCategory || e.category === filterCategory;
    const matchRecon = !filterRecon || (filterRecon === "yes" ? e.reconciled : !e.reconciled);
    return matchQ && matchCat && matchRecon;
  });

  const totalShown = filtered.reduce((s, e) => s + e.amount, 0);

  // Bulk delete (developer only)
  const { selectedIds, toggle: toggleSelect, selectAll, clearSelection } = useBulkSelect(filtered.map(e => e.id));

  async function bulkDeleteSelected(ids: string[]) {
    if (ids.length === 0) return;
    // Single round-trip via .in() so a single RLS/constraint denial surfaces
    // as one error instead of being swallowed inside a per-id loop.
    const { error } = await supabase.from("income_entries").delete().in("id", ids);
    if (error) { notify(`Bulk delete failed: ${error.message}`, "error"); return; }
    await supabase.from("activity_log").insert({ user_email: profile?.email, user_name: profile?.full_name, action: "Bulk Delete Income", details: `${ids.length} entries deleted` });
    notify(`Deleted ${ids.length} entries`);
    load();
  }

  async function bulkDeleteAll() {
    const { error } = await supabase.from("income_entries").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) { notify(`Purge failed: ${error.message}`, "error"); return; }
    await supabase.from("activity_log").insert({ user_email: profile?.email, user_name: profile?.full_name, action: "Purge All Income", details: `All income entries deleted` });
    notify("All income entries deleted");
    load();
  }

  async function toggleReconcile(entry: IncomeEntry) {
    const next = !entry.reconciled;
    // Optimistic flip so the UI feels instant; roll back on error.
    setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, reconciled: next } : e));
    const { error } = await supabase.from("income_entries").update({ reconciled: next, updated_at: new Date().toISOString() }).eq("id", entry.id);
    if (error) {
      setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, reconciled: entry.reconciled } : e));
      notify(`Reconcile failed: ${error.message}`, "error");
    }
  }

  function handleExport() {
    exportCSV(filtered.map(e => ({
      Receipt: e.receipt_no,
      Date: fmtDate(e.date),
      Student: e.student_name || "",
      Category: e.category,
      Description: e.description || "",
      Amount: e.amount,
      Method: e.payment_method,
      Term: e.term || "",
      Reconciled: e.reconciled ? "Yes" : "No",
    })), "income-ledger");
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        icon={<TrendingUp size={24} />}
        gradient="emerald" title="Income Ledger" subtitle="All fee payments and other income">
        <Button variant="secondary" size="sm" onClick={handleExport}>
          <Download size={14} /> Export CSV
        </Button>
        {canEdit && (
          <Button onClick={() => setShowAdd(true)}>
            <Plus size={16} /> Record Payment
          </Button>
        )}
      </PageHeader>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border p-4">
          <div className="text-xs text-gray-500 mb-1">Total Shown</div>
          <div className="text-xl font-bold text-green-700">{fmtMoney(totalShown)}</div>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <div className="text-xs text-gray-500 mb-1">Records</div>
          <div className="text-xl font-bold text-[#0F2A47]">{filtered.length}</div>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <div className="text-xs text-gray-500 mb-1">Reconciled</div>
          <div className="text-xl font-bold text-[#C9A227]">{filtered.filter(e => e.reconciled).length}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Search receipt, student, category…"
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]" />
        </div>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
          className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white">
          <option value="">All categories</option>
          {INCOME_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterRecon} onChange={e => setFilterRecon(e.target.value)}
          className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white">
          <option value="">All reconciliation</option>
          <option value="yes">Reconciled</option>
          <option value="no">Unreconciled</option>
        </select>
      </div>

      {loading ? <LoadingSpinner /> : (
        <>
          {/* Developer bulk delete bar */}
          <BulkDeleteBar
            selectedIds={selectedIds}
            totalCount={filtered.length}
            itemLabel="income entries"
            onDeleteSelected={bulkDeleteSelected}
            onDeleteAll={bulkDeleteAll}
            onSelectAll={selectAll}
            onClearSelection={clearSelection}
            isDeveloper={isDeveloper}
          />
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#0F2A47] text-white">
                  {isDeveloper && <th className="w-8 px-2 py-3" />}
                  <th className="text-left px-4 py-3 text-xs font-semibold">Receipt</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Student</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Category</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Description</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Method</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold">Amount</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Recon.</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={isDeveloper ? 10 : 9}><EmptyState message="No income records found." /></td></tr>
                ) : (
                  filtered.map(entry => (
                    <tr key={entry.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <RowCheckbox id={entry.id} selectedIds={selectedIds} onToggle={toggleSelect} isDeveloper={isDeveloper} />
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-[#0F2A47]">{entry.receipt_no}</td>
                      <td className="px-4 py-3 text-gray-600">{fmtDate(entry.date)}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{entry.student_name || "—"}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{entry.category}</td>
                      <td className="px-4 py-3 text-gray-500 max-w-[150px] truncate">{entry.description || "—"}</td>
                      <td className="px-4 py-3 text-gray-600">{entry.payment_method}</td>
                      <td className="px-4 py-3 text-right font-bold text-green-700">{fmtMoney(entry.amount)}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => toggleReconcile(entry)} title={entry.reconciled ? "Mark unreconciled" : "Mark reconciled"}
                          className="text-gray-400 hover:text-[#0F2A47] transition-colors">
                          {entry.reconciled
                            ? <CheckCircle size={16} className="text-green-600" />
                            : <Circle size={16} />}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <ReceiptButton entry={entry} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
        </>
      )}

      {showAdd && (
        <AddIncomeModal
          students={students}
          fees={fees}
          defaultStudentId={defaultStudentId}
          onClose={() => { setShowAdd(false); load(); }}
        />
      )}
      <ToastHost />
    </div>
  );
}

function ReceiptButton({ entry }: { entry: IncomeEntry }) {
  const [showReceipt, setShowReceipt] = useState(false);
  return (
    <>
      <button onClick={() => setShowReceipt(true)}
        className="flex items-center gap-1 text-xs text-[#0F2A47] hover:underline font-medium">
        <Receipt size={12} /> Receipt
      </button>
      {showReceipt && <ReceiptModal entry={entry} onClose={() => setShowReceipt(false)} />}
    </>
  );
}

function ReceiptModal({ entry, onClose }: { entry: IncomeEntry; onClose: () => void }) {
  const supabase = createClient();
  const [settings, setSettings] = useState<any>(null);

  useEffect(() => {
    supabase.from("school_settings").select("*").limit(1).single().then(({ data }) => {
      setSettings(data);
    });
  }, [supabase]);

  const schoolName = settings?.school_name || "School Finance Suite";
  const schoolAddress = settings?.address || "";
  const schoolPhone = settings?.phone || "";
  const schoolEmail = settings?.email || "";
  const receiptFooter = settings?.receipt_footer || "Thank you for your payment.";

  async function downloadPDF() {
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a5" });
    const pageW = doc.internal.pageSize.getWidth();

    // Navy header
    doc.setFillColor(15, 42, 71);
    doc.rect(0, 0, pageW, 35, "F");
    doc.setTextColor(201, 162, 39);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(schoolName, pageW / 2, 12, { align: "center" });
    doc.setTextColor(200, 210, 220);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    if (schoolAddress) doc.text(schoolAddress, pageW / 2, 18, { align: "center" });
    const contactLine = [schoolPhone, schoolEmail].filter(Boolean).join(" | ");
    if (contactLine) doc.text(contactLine, pageW / 2, 23, { align: "center" });
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.text("PAYMENT RECEIPT", pageW / 2, 30, { align: "center" });

    // Receipt number banner
    doc.setFillColor(244, 233, 199);
    doc.rect(10, 39, pageW - 20, 10, "F");
    doc.setTextColor(15, 42, 71);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(`Receipt No: ${entry.receipt_no}`, pageW / 2, 46, { align: "center" });

    // Details table
    autoTable(doc, {
      startY: 55,
      margin: { left: 10, right: 10 },
      styles: { fontSize: 10, cellPadding: 3.5 },
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 45, fillColor: [247, 245, 240] } },
      body: [
        ["Date", fmtDate(entry.date)],
        ["Student Name", entry.student_name || "—"],
        ["Category", entry.category],
        ["Description", entry.description || "—"],
        ["Payment Method", entry.payment_method],
        ["Term / Session", entry.term || "—"],
        ["Recorded By", entry.recorded_by || "—"],
      ],
      theme: "grid",
    });

    const finalY = (doc as any).lastAutoTable?.finalY || 125;

    // Amount highlight
    doc.setFillColor(15, 42, 71);
    doc.rect(10, finalY + 5, pageW - 20, 16, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.text("AMOUNT PAID", 18, finalY + 14);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(fmtMoney(entry.amount), pageW - 15, finalY + 14, { align: "right" });

    // Footer
    doc.setTextColor(130, 130, 130);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(receiptFooter, pageW / 2, finalY + 30, { align: "center" });
    doc.text(`Generated: ${new Date().toLocaleString("en-NG")}`, pageW / 2, finalY + 36, { align: "center" });

    doc.save(`receipt-${entry.receipt_no}.pdf`);
  }

  return (
    <Modal open onClose={onClose} title="Payment Receipt" size="sm">
      <div className="space-y-0">
        {/* Branded header */}
        <div className="text-center py-4 border-b bg-[#0F2A47] -mx-6 -mt-4 px-6 rounded-t-xl">
          <div className="text-[#C9A227] font-bold text-base">{schoolName}</div>
          {schoolAddress && <div className="text-[#B8C8DC] text-xs mt-0.5">{schoolAddress}</div>}
          {(schoolPhone || schoolEmail) && (
            <div className="text-[#8AA8C8] text-xs mt-0.5">{[schoolPhone, schoolEmail].filter(Boolean).join(" · ")}</div>
          )}
          <div className="text-white text-xs opacity-80 mt-1">PAYMENT RECEIPT</div>
        </div>
        {/* Receipt number */}
        <div className="bg-[#F4E9C7] py-2 text-center text-sm font-bold text-[#0F2A47] -mx-6 px-6 mb-4">
          {entry.receipt_no}
        </div>
        {/* Details */}
        {[
          ["Date", fmtDate(entry.date)],
          ["Student", entry.student_name || "—"],
          ["Category", entry.category],
          ["Description", entry.description || "—"],
          ["Payment Method", entry.payment_method],
          ["Term", entry.term || "—"],
          ["Recorded By", entry.recorded_by || "—"],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between py-2.5 border-b border-dashed border-gray-100 text-sm">
            <span className="text-gray-500">{k}</span>
            <span className="font-medium text-right">{v}</span>
          </div>
        ))}
        {/* Amount */}
        <div className="flex justify-between items-center py-3 mt-2 bg-[#0F2A47] -mx-6 px-6 rounded-b-xl">
          <span className="text-white text-sm font-medium">AMOUNT PAID</span>
          <span className="text-[#C9A227] text-xl font-bold">{fmtMoney(entry.amount)}</span>
        </div>
        {/* Footer */}
        <p className="text-xs text-gray-400 text-center pt-3">{receiptFooter}</p>
        <div className="flex gap-2 pt-3">
          <Button variant="secondary" size="sm" className="flex-1" onClick={onClose}>Close</Button>
          <Button variant="gold" size="sm" className="flex-1" onClick={downloadPDF}>
            Download PDF
          </Button>
        </div>
      </div>
    </Modal>
  );
}

interface AddIncomeModalProps {
  students: Student[];
  fees: FeeSchedule[];
  defaultStudentId: string;
  onClose: () => void;
}

function AddIncomeModal({ students, fees, defaultStudentId, onClose }: AddIncomeModalProps) {
  const supabase = createClient();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState(defaultStudentId);
  const [selectedFeeId, setSelectedFeeId] = useState("");

  const [form, setForm] = useState({
    category: INCOME_CATEGORIES[0] as string,
    description: "",
    amount: "",
    payment_method: PAYMENT_METHODS[0] as string,
    term: "",
    date: today(),
    notes: "",
  });

  const selectedStudent = students.find(s => s.id === selectedStudentId);
  const studentOptions = students.map(s => ({
    value: s.id,
    label: s.full_name,
    sublabel: `${s.student_code}${s.grade ? ` · ${s.grade}` : ""}`,
  }));

  // Fees applicable to the student's grade
  const applicableFees = fees.filter(f => !f.grade || !selectedStudent?.grade || f.grade === selectedStudent.grade);
  const feeOptions = [
    { value: "", label: "No specific fee" },
    ...applicableFees.map(f => ({
      value: f.id,
      label: f.name,
      sublabel: `${fmtMoney(f.amount)} · ${f.category}`,
    })),
  ];

  function handleFeeSelect(feeId: string) {
    setSelectedFeeId(feeId);
    if (feeId) {
      const fee = fees.find(f => f.id === feeId);
      if (fee) {
        setForm(f => ({
          ...f,
          category: fee.category,
          description: fee.name,
          amount: String(fee.amount),
          term: fee.term || f.term,
        }));
      }
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.amount || isNaN(parseFloat(form.amount))) { setError("Enter a valid amount."); return; }
    setLoading(true);
    setError("");

    const { receiptNo, error: insertError } = await insertIncomeWithReceipt(supabase, {
      date: form.date,
      student_id: selectedStudentId || null,
      student_name: selectedStudent?.full_name || null,
      category: form.category,
      description: form.description || null,
      amount: parseFloat(form.amount),
      payment_method: form.payment_method,
      term: form.term || null,
      recorded_by: profile?.full_name || profile?.email,
      reconciled: false,
      payment_source: "manual",
      notes: form.notes || null,
    });

    if (insertError || !receiptNo) {
      setError(insertError?.message || "The database did not return a receipt number.");
      setLoading(false);
      return;
    }

    await supabase.from("activity_log").insert({
      user_email: profile?.email, user_name: profile?.full_name,
      action: "Record Income", details: `${receiptNo} — ${selectedStudent?.full_name || "No student"} — ${fmtMoney(parseFloat(form.amount))}`,
    });

    onClose();
  }

  return (
    <Modal open onClose={onClose} title="Record Student Payment" size="lg">
      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
      <form onSubmit={submit} className="space-y-4">
        <SearchableSelect
          label="Student"
          options={studentOptions}
          value={selectedStudentId}
          onChange={setSelectedStudentId}
          placeholder="Search and select student…"
        />

        <SearchableSelect
          label="Apply to Fee (optional)"
          options={feeOptions}
          value={selectedFeeId}
          onChange={handleFeeSelect}
          placeholder="Select fee to auto-fill details…"
        />

        <div className="grid grid-cols-2 gap-3">
          <Select label="Category" value={form.category} onChange={set("category")}
            options={INCOME_CATEGORIES.map(c => ({ value: c, label: c }))} />
          <Input label="Description" value={form.description} onChange={set("description")} placeholder="e.g. Term 1 tuition" />
          <Input label="Amount (₦)" type="number" value={form.amount} onChange={set("amount")} min="0" step="0.01" required />
          <Select label="Payment Method" value={form.payment_method} onChange={set("payment_method")}
            options={PAYMENT_METHODS.map(m => ({ value: m, label: m }))} />
          <Input label="Term / Session" value={form.term} onChange={set("term")} placeholder="e.g. Term 1 2026" />
          <Input label="Date" type="date" value={form.date} onChange={set("date")} required />
        </div>

        <Input label="Notes (optional)" value={form.notes} onChange={set("notes")} />

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="gold" loading={loading}>Record Payment</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function IncomePage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <IncomePageInner />
    </Suspense>
  );
}
