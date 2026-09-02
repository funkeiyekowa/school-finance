"use client";

/**
 * Bulk-printable overdue notices.
 *
 * Every currently-overdue loan becomes a small notice card that a
 * librarian can hand to the student or send home with them. Opens in a
 * new tab so browser print → Save as PDF captures the whole batch in
 * one shot without disturbing the library page behind it.
 */

import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useBranding } from "@/lib/hooks/useBranding";
import { fmtMoney, fmtDate } from "@/lib/utils";
import { LoadingSpinner } from "@/components/ui/PageHeader";
import { PrintableLetterhead, PrintableFooter } from "@/components/print/PrintableLetterhead";
import { Printer } from "lucide-react";

interface LoanRow {
  id: string; copy_id: string;
  borrower_type: string; student_id: string | null; staff_id: string | null;
  borrower_name: string | null;
  borrowed_at: string; due_date: string; returned_at: string | null;
  fine_amount: number; status: string;
}
interface CopyRow { id: string; book_id: string; copy_code: string; }
interface BookRow { id: string; title: string; author: string | null; isbn: string | null; }

const FINE_PER_DAY = 50;

export default function OverdueNoticesPage() {
  const supabase = useMemo(() => createClient(), []);
  const { orgId } = useAuth();
  const branding = useBranding();
  const [loading, setLoading] = useState(true);
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [copies, setCopies] = useState<CopyRow[]>([]);
  const [books, setBooks] = useState<BookRow[]>([]);

  useEffect(() => {
    if (!orgId) return;
    (async () => {
      const [loanRes, copyRes, bookRes] = await Promise.all([
        supabase.from("library_loans").select("*").eq("status", "active"),
        supabase.from("library_copies").select("id, book_id, copy_code"),
        supabase.from("library_books").select("id, title, author, isbn"),
      ]);
      setLoans((loanRes.data as LoanRow[]) ?? []);
      setCopies((copyRes.data as CopyRow[]) ?? []);
      setBooks((bookRes.data as BookRow[]) ?? []);
      setLoading(false);
    })();
  }, [supabase, orgId]);

  const copyById = useMemo(() => new Map(copies.map((c) => [c.id, c])), [copies]);
  const bookById = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);

  const today = new Date().toISOString().slice(0, 10);
  const overdue = loans.filter((l) => l.due_date < today);

  if (loading || !branding) return <div className="p-8"><LoadingSpinner /></div>;

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <div className="no-print sticky top-0 z-10 bg-[#0F2A47] text-white px-6 py-3 flex items-center justify-between shadow-md">
        <div>
          <p className="text-xs uppercase tracking-wider text-[#C9A227] font-bold">Overdue Notices</p>
          <p className="text-sm font-medium">{overdue.length} notice{overdue.length === 1 ? "" : "s"} — {branding.schoolName}</p>
        </div>
        <button
          onClick={() => window.print()}
          disabled={overdue.length === 0}
          className="flex items-center gap-2 bg-[#C9A227] text-[#0F2A47] px-4 py-2 rounded-lg text-sm font-bold hover:bg-[#e6bf39] transition-colors disabled:opacity-40"
        >
          <Printer size={14} /> Print / Save as PDF
        </button>
      </div>

      {overdue.length === 0 ? (
        <div className="p-16 text-center text-gray-500">Nothing overdue — great job!</div>
      ) : (
        <div className="max-w-3xl mx-auto py-6 print:py-0 print:max-w-full">
          {overdue.map((l) => {
            const copy = copyById.get(l.copy_id);
            const book = copy ? bookById.get(copy.book_id) : null;
            const daysLate = Math.floor((Date.now() - new Date(l.due_date).getTime()) / 86400000);
            const estFine = daysLate * FINE_PER_DAY;
            return (
              <div key={l.id} className="bg-white shadow-sm rounded-lg p-8 mb-4 print:shadow-none print:mb-0 print:rounded-none notice-page">
                <PrintableLetterhead branding={branding} eyebrow="Overdue Book Notice" accent="rose" />

                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm mb-4">
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase font-bold">Borrower</p>
                    <p className="font-medium text-[#0F2A47]">{l.borrower_name ?? "Unknown"}</p>
                    <p className="text-xs text-gray-500 capitalize">{l.borrower_type}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase font-bold">Book</p>
                    <p className="font-medium text-[#0F2A47]">{book?.title || "Unknown title"}</p>
                    <p className="text-xs text-gray-500">{book?.author || ""} {copy?.copy_code ? `· ${copy.copy_code}` : ""}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase font-bold">Borrowed</p>
                    <p className="text-sm">{fmtDate(l.borrowed_at)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase font-bold">Due</p>
                    <p className="text-sm text-red-700 font-medium">{fmtDate(l.due_date)}</p>
                  </div>
                </div>

                <div className="rounded-lg bg-red-50 border border-red-200 p-3 mb-3">
                  <p className="text-sm">
                    <span className="font-bold text-red-700">{daysLate} day{daysLate === 1 ? "" : "s"} overdue.</span>
                    <span className="text-red-700"> Estimated fine to date: <strong>{fmtMoney(estFine)}</strong></span>
                  </p>
                  <p className="text-xs text-red-600 mt-1">
                    Please return the book to the school library as soon as possible. Fine accrues at {fmtMoney(FINE_PER_DAY)} per day.
                  </p>
                </div>

                <div className="mt-6 pt-3 border-t border-gray-100 flex items-center justify-between text-[10px] text-gray-500">
                  <p>Notice issued {fmtDate(today)}</p>
                  <div className="text-right">
                    <p>_______________________________</p>
                    <p>Librarian&apos;s Signature</p>
                  </div>
                </div>
                <PrintableFooter branding={branding} />
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        @media print {
          .notice-page { page-break-after: always; }
          .notice-page:last-child { page-break-after: auto; }
          @page { size: A4; margin: 15mm; }
        }
      `}</style>
    </div>
  );
}
