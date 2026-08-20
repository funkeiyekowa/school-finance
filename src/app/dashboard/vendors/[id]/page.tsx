"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fmtMoney, fmtDate, cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { LoadingSpinner } from "@/components/ui/PageHeader";
import { ChevronLeft, Phone, Mail, MapPin } from "lucide-react";
import Link from "next/link";
import type { Vendor, ExpenseEntry } from "@/lib/types";

export default function VendorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [history, setHistory] = useState<ExpenseEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [venRes, histRes] = await Promise.all([
      supabase.from("vendors").select("*").eq("id", id).single(),
      supabase.from("expense_entries").select("*").eq("vendor_id", id).order("date", { ascending: false }),
    ]);
    setVendor(venRes.data);
    setHistory(histRes.data ?? []);
    setLoading(false);
  }, [id, supabase]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;
  if (!vendor) return <div className="p-6 text-gray-500">Vendor not found.</div>;

  const totalPaid = history.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="p-6 space-y-5">
      <button onClick={() => router.back()} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ChevronLeft size={16} /> Back to Vendors
      </button>

      <div className="grid lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>{vendor.name}</CardTitle>
            <p className="text-xs text-gray-400 font-mono mt-1">{vendor.vendor_code}</p>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {vendor.category && <Row label="Category" value={vendor.category} />}
            {vendor.contact_person && <Row label="Contact" value={vendor.contact_person} />}
            {vendor.phone && (
              <div className="flex items-center gap-2 pt-1">
                <Phone size={13} className="text-gray-400" />
                <span className="text-gray-600">{vendor.phone}</span>
              </div>
            )}
            {vendor.email && (
              <div className="flex items-center gap-2">
                <Mail size={13} className="text-gray-400" />
                <span className="text-gray-600">{vendor.email}</span>
              </div>
            )}
            {vendor.address && (
              <div className="flex items-start gap-2 pt-1 border-t border-gray-100">
                <MapPin size={13} className="text-gray-400 mt-0.5" />
                <span className="text-gray-600">{vendor.address}</span>
              </div>
            )}
            {vendor.notes && <p className="text-gray-500 text-xs pt-2 border-t border-gray-100">{vendor.notes}</p>}
          </CardContent>
        </Card>

        <div className="lg:col-span-2 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white rounded-xl border p-4">
              <div className="text-xs text-gray-500 mb-1">Total Payments</div>
              <div className="text-xl font-bold text-red-700">{fmtMoney(totalPaid)}</div>
            </div>
            <div className="bg-white rounded-xl border p-4">
              <div className="text-xs text-gray-500 mb-1">Vouchers Issued</div>
              <div className="text-xl font-bold text-[#0F2A47]">{history.length}</div>
            </div>
          </div>

          <div className="flex gap-2">
            <Link href={`/dashboard/expenses?vendor=${vendor.id}`}>
              <button className="px-4 py-2 bg-[#C9A227] text-[#0F2A47] rounded-lg text-sm font-bold hover:bg-[#b8911e]">
                Record Expense
              </button>
            </Link>
          </div>

          <Card>
            <CardHeader><CardTitle>Expense History</CardTitle></CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600">Voucher</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600">Date</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600">Category</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600">Description</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-600">Amount</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600">Recon.</th>
                  </tr>
                </thead>
                <tbody>
                  {history.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-8 text-gray-400 text-sm">No expenses recorded</td></tr>
                  ) : (
                    history.map(r => (
                      <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-4 py-2.5 font-mono text-xs font-semibold text-[#0F2A47]">{r.voucher_no}</td>
                        <td className="px-4 py-2.5 text-gray-600">{fmtDate(r.date)}</td>
                        <td className="px-4 py-2.5 text-gray-600">{r.category}</td>
                        <td className="px-4 py-2.5 text-gray-500 max-w-[140px] truncate">{r.description || "—"}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-red-700">{fmtMoney(r.amount)}</td>
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-gray-50 pb-2">
      <span className="text-gray-500 text-xs">{label}</span>
      <span className="font-medium text-gray-900 text-sm">{value}</span>
    </div>
  );
}
