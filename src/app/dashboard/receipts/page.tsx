"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { fmtMoney, fmtDate } from "@/lib/utils";
import { PageHeader, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";
import { Search, Receipt, Download, Printer } from "lucide-react";
import type { IncomeEntry, SchoolSettings } from "@/lib/types";

export default function ReceiptsPage() {
  const supabase = createClient();
  const [entries, setEntries] = useState<IncomeEntry[]>([]);
  const [settings, setSettings] = useState<SchoolSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<IncomeEntry | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [entRes, setRes] = await Promise.all([
      supabase.from("income_entries").select("*").order("date", { ascending: false }),
      supabase.from("school_settings").select("*").limit(1).single(),
    ]);
    setEntries(entRes.data ?? []);
    setSettings(setRes.data);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const filtered = entries.filter(e => {
    const q = search.toLowerCase();
    return !q || e.receipt_no.toLowerCase().includes(q) || (e.student_name || "").toLowerCase().includes(q);
  });

  async function downloadPDF(entry: IncomeEntry) {
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a5" });
    const schoolName = settings?.school_name || "School Finance Suite";
    const pageW = doc.internal.pageSize.getWidth();

    // Header
    doc.setFillColor(15, 42, 71);
    doc.rect(0, 0, pageW, 30, "F");
    doc.setTextColor(201, 162, 39);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(schoolName, pageW / 2, 12, { align: "center" });
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("PAYMENT RECEIPT", pageW / 2, 20, { align: "center" });

    // Receipt number banner
    doc.setFillColor(244, 233, 199);
    doc.rect(10, 34, pageW - 20, 10, "F");
    doc.setTextColor(15, 42, 71);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(`Receipt No: ${entry.receipt_no}`, pageW / 2, 41, { align: "center" });

    // Details table
    autoTable(doc, {
      startY: 50,
      margin: { left: 10, right: 10 },
      styles: { fontSize: 10, cellPadding: 3 },
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

    // Amount highlight
    const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY || 120;
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
    doc.text(settings?.receipt_footer || "Thank you for your payment.", pageW / 2, finalY + 30, { align: "center" });
    doc.text(`Generated: ${new Date().toLocaleString("en-NG")}`, pageW / 2, finalY + 36, { align: "center" });

    doc.save(`receipt-${entry.receipt_no}.pdf`);
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Receipts" subtitle="View and download payment receipts">
        <button
          onClick={() => {
            const ids = filtered.map((e) => e.id).join(",");
            if (!ids) return;
            window.open(`/dashboard/receipts/bulk-print?ids=${ids}`, "_blank");
          }}
          className="text-xs font-semibold text-[#0F2A47] hover:text-[#C9A227] border border-gray-200 hover:border-[#C9A227] px-2.5 py-1.5 rounded-lg flex items-center gap-1"
          disabled={filtered.length === 0}
          title="Batch-print every filtered receipt as one PDF"
        >
          <Printer size={13} /> Print batch
        </button>
        <span className="text-sm text-gray-400">{entries.length} receipts total</span>
      </PageHeader>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input type="text" placeholder="Search by receipt number or student name…"
          value={search} onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]" />
      </div>

      {loading ? <LoadingSpinner /> : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#0F2A47] text-white">
                  <th className="text-left px-4 py-3 text-xs font-semibold">Receipt No.</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Student</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Category</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Method</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold">Amount</th>
                  <th className="px-4 py-3 text-xs font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={7}><EmptyState message="No receipts found." icon={<Receipt size={32} />} /></td></tr>
                ) : (
                  filtered.map(entry => (
                    <tr key={entry.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-[#0F2A47]">{entry.receipt_no}</td>
                      <td className="px-4 py-3 text-gray-600">{fmtDate(entry.date)}</td>
                      <td className="px-4 py-3 font-medium">{entry.student_name || "—"}</td>
                      <td className="px-4 py-3 text-gray-600">{entry.category}</td>
                      <td className="px-4 py-3 text-gray-600">{entry.payment_method}</td>
                      <td className="px-4 py-3 text-right font-bold text-green-700">{fmtMoney(entry.amount)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button onClick={() => setSelected(entry)}
                            className="flex items-center gap-1 text-xs text-[#0F2A47] hover:underline font-medium">
                            <Receipt size={12} /> View
                          </button>
                          <button onClick={() => downloadPDF(entry)}
                            className="flex items-center gap-1 text-xs text-gray-500 hover:text-[#0F2A47] hover:underline font-medium">
                            <Download size={12} /> PDF
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {selected && (
        <Modal open onClose={() => setSelected(null)} title="Payment Receipt" size="sm">
          <div className="space-y-0">
            <div className="text-center py-4 border-b bg-[#0F2A47] -mx-6 -mt-4 px-6 rounded-t-xl">
              <div className="text-[#C9A227] font-bold text-base">{settings?.school_name || "School Finance Suite"}</div>
              <div className="text-white text-xs opacity-80">PAYMENT RECEIPT</div>
            </div>
            <div className="bg-[#F4E9C7] py-2 text-center text-sm font-bold text-[#0F2A47] -mx-6 px-6 mb-4">
              {selected.receipt_no}
            </div>
            {[
              ["Date", fmtDate(selected.date)],
              ["Student", selected.student_name || "—"],
              ["Category", selected.category],
              ["Description", selected.description || "—"],
              ["Payment Method", selected.payment_method],
              ["Term", selected.term || "—"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between py-2.5 border-b border-dashed border-gray-100 text-sm">
                <span className="text-gray-500">{k}</span>
                <span className="font-medium text-right">{v}</span>
              </div>
            ))}
            <div className="flex justify-between items-center py-3 mt-2 bg-[#0F2A47] -mx-6 px-6 rounded-b-xl">
              <span className="text-white text-sm font-medium">AMOUNT PAID</span>
              <span className="text-[#C9A227] text-xl font-bold">{fmtMoney(selected.amount)}</span>
            </div>
            <p className="text-xs text-gray-400 text-center pt-3">{settings?.receipt_footer || "Thank you for your payment."}</p>
            <div className="flex gap-2 pt-3">
              <Button variant="secondary" size="sm" className="flex-1" onClick={() => setSelected(null)}>Close</Button>
              <Button variant="gold" size="sm" className="flex-1" onClick={() => downloadPDF(selected)}>
                <Download size={13} /> Download PDF
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
