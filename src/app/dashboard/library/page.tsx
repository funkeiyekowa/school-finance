"use client";

/**
 * Library module — book catalogue, per-copy circulation, and
 * reservations. Four tabs, matching the Transport module's
 * list+modal CRUD convention:
 *
 *   Catalogue    — books and their physical copies. A book can have
 *                  many copies (LIB-0001, LIB-0002...), each
 *                  independently borrowable.
 *   Loans        — checkout/return flow. Checkout and return both go
 *                  through server-side RPCs (library_checkout_copy /
 *                  library_return_copy) rather than client writes, so
 *                  the "is this copy actually available" check and the
 *                  overdue-fine calculation can't race or be spoofed.
 *   Reservations — a queue for books that are fully checked out.
 *   Overdue      — active loans past their due date, with one-click
 *                  return + fine collection.
 *
 * Borrowers are students or staff — every borrower-picker lets staff
 * search across both in one list (labeled by type) since a school
 * library serves everyone.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useToast } from "@/lib/hooks/useToast";
import { extractErrorMessage } from "@/lib/errors/extractErrorMessage";
import { fmtDate, fmtMoney, cn, generateCode } from "@/lib/utils";
import { PageHeader, LoadingSpinner, EmptyState, KpiCard } from "@/components/ui/PageHeader";
import { Tabs, TabDef } from "@/components/ui/Tabs";
import { SetupHero } from "@/components/ui/SetupHero";
import { exportRowsAsCsv } from "@/lib/export/csv";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import {
  BookOpen, Plus, Search, Users, Layers, AlertTriangle, CheckCircle2,
  Bookmark, ArrowLeftRight, Trash2, Pencil, Download,
} from "lucide-react";

interface BookRow {
  id: string; isbn: string | null; title: string; author: string | null; publisher: string | null;
  category: string | null; description: string | null; cover_color: string; status: string;
}
interface CopyRow {
  id: string; book_id: string; copy_code: string; condition: string; status: string; shelf_location: string | null;
}
interface LoanRow {
  id: string; copy_id: string; student_id: string | null; staff_id: string | null; status: string;
  borrowed_at: string; due_date: string; returned_at: string | null; fine_amount: number; fine_paid: boolean;
}
interface ReservationRow {
  id: string; book_id: string; student_id: string | null; staff_id: string | null; status: string; reserved_at: string;
}
interface StudentOption { id: string; full_name: string; student_code: string; }
interface StaffOption { id: string; full_name: string; staff_code: string; }
interface Stats { total_titles: number; total_copies: number; available_copies: number; active_loans: number; overdue_loans: number; }

type Tab = "catalogue" | "loans" | "reservations" | "overdue";

const FINE_PER_DAY = 50; // school's overdue fine rate, in local currency units per day late

export default function LibraryPage() {
  const { canEdit, orgId } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const { notify, ToastHost } = useToast();

  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("catalogue");
  const [search, setSearch] = useState("");

  const [books, setBooks] = useState<BookRow[]>([]);
  const [copies, setCopies] = useState<CopyRow[]>([]);
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [reservations, setReservations] = useState<ReservationRow[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [stats, setStats] = useState<Stats>({ total_titles: 0, total_copies: 0, available_copies: 0, active_loans: 0, overdue_loans: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    const [bRes, cRes, lRes, rRes, sRes, stfRes, statsRes] = await Promise.all([
      supabase.from("library_books").select("*").order("title"),
      supabase.from("library_book_copies").select("*").order("copy_code"),
      supabase.from("library_loans").select("*").order("borrowed_at", { ascending: false }),
      supabase.from("library_reservations").select("*").order("reserved_at", { ascending: false }),
      supabase.from("students").select("id, full_name, student_code").eq("status", "active").order("full_name"),
      supabase.from("staff_members").select("id, full_name, staff_code").eq("status", "active").order("full_name"),
      supabase.rpc("library_stats"),
    ]);
    setBooks((bRes.data as BookRow[]) ?? []);
    setCopies((cRes.data as CopyRow[]) ?? []);
    setLoans((lRes.data as LoanRow[]) ?? []);
    setReservations((rRes.data as ReservationRow[]) ?? []);
    setStudents((sRes.data as StudentOption[]) ?? []);
    setStaff((stfRes.data as StaffOption[]) ?? []);
    if (statsRes.data && statsRes.data[0]) {
      const s = statsRes.data[0];
      setStats({
        total_titles: s.total_titles || 0,
        total_copies: s.total_copies || 0,
        available_copies: s.available_copies || 0,
        active_loans: s.active_loans || 0,
        overdue_loans: s.overdue_loans || 0,
      });
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const bookById = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);
  const copyById = useMemo(() => new Map(copies.map((c) => [c.id, c])), [copies]);
  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);
  const copiesByBook = useMemo(() => {
    const map: Record<string, CopyRow[]> = {};
    for (const c of copies) (map[c.book_id] ||= []).push(c);
    return map;
  }, [copies]);

  function borrowerLabel(l: { student_id: string | null; staff_id: string | null }): string {
    if (l.student_id) {
      const s = studentById.get(l.student_id);
      return s ? `${s.full_name} (${s.student_code})` : "Unknown student";
    }
    if (l.staff_id) {
      const s = staffById.get(l.staff_id);
      return s ? `${s.full_name} (staff)` : "Unknown staff";
    }
    return "Unknown";
  }

  /* ---------------- Books & copies ---------------- */
  const [showBookForm, setShowBookForm] = useState(false);
  const [editingBook, setEditingBook] = useState<BookRow | null>(null);
  const emptyBookForm = { isbn: "", title: "", author: "", publisher: "", category: "", description: "", cover_color: "#0F2A47" };
  const [bookForm, setBookForm] = useState(emptyBookForm);
  const [savingBook, setSavingBook] = useState(false);
  const [expandedBook, setExpandedBook] = useState<string | null>(null);
  const [addingCopyFor, setAddingCopyFor] = useState<BookRow | null>(null);
  const [copyShelf, setCopyShelf] = useState("");
  const [savingCopy, setSavingCopy] = useState(false);

  const COLORS = ["#0F2A47", "#C9A227", "#7C3AED", "#059669", "#DC2626", "#0891B2"];

  function openBookForm(b?: BookRow) {
    if (b) {
      setEditingBook(b);
      setBookForm({ isbn: b.isbn || "", title: b.title, author: b.author || "", publisher: b.publisher || "", category: b.category || "", description: b.description || "", cover_color: b.cover_color });
    } else {
      setEditingBook(null);
      setBookForm(emptyBookForm);
    }
    setShowBookForm(true);
  }

  async function saveBook() {
    if (!bookForm.title.trim()) { notify("Title is required.", "error"); return; }
    setSavingBook(true);
    try {
      const payload = {
        isbn: bookForm.isbn.trim() || null,
        title: bookForm.title.trim(),
        author: bookForm.author.trim() || null,
        publisher: bookForm.publisher.trim() || null,
        category: bookForm.category.trim() || null,
        description: bookForm.description.trim() || null,
        cover_color: bookForm.cover_color,
      };
      if (editingBook) {
        const { error } = await supabase.from("library_books").update(payload).eq("id", editingBook.id);
        if (error) throw error;
        notify("Book updated.");
      } else {
        const { error } = await supabase.from("library_books").insert({ ...payload, organization_id: orgId });
        if (error) throw error;
        notify("Book added to catalogue.");
      }
      setShowBookForm(false);
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Failed to save book."), "error");
    } finally {
      setSavingBook(false);
    }
  }

  async function retireBook(b: BookRow) {
    if (!confirm(`Retire "${b.title}" from the catalogue? Existing copies and loan history are kept.`)) return;
    const { error } = await supabase.from("library_books").update({ status: "retired" }).eq("id", b.id);
    if (error) { notify(extractErrorMessage(error, "Failed to retire book."), "error"); return; }
    notify("Book retired.");
    load();
  }

  async function addCopy() {
    if (!addingCopyFor) return;
    setSavingCopy(true);
    try {
      const existingCodes = copies.map((c) => c.copy_code);
      const code = generateCode("LIB-", existingCodes);
      const { error } = await supabase.from("library_book_copies").insert({
        book_id: addingCopyFor.id,
        copy_code: code,
        shelf_location: copyShelf.trim() || null,
        organization_id: orgId,
      });
      if (error) throw error;
      notify(`Copy ${code} added.`);
      setAddingCopyFor(null);
      setCopyShelf("");
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Failed to add copy."), "error");
    } finally {
      setSavingCopy(false);
    }
  }

  async function retireCopy(c: CopyRow) {
    if (c.status === "borrowed") { notify("This copy is currently on loan — it must be returned first.", "error"); return; }
    if (!confirm(`Retire copy ${c.copy_code}?`)) return;
    const { error } = await supabase.from("library_book_copies").update({ status: "retired" }).eq("id", c.id);
    if (error) { notify(extractErrorMessage(error, "Failed to retire copy."), "error"); return; }
    load();
  }

  /* ---------------- Checkout / return ---------------- */
  const [showCheckout, setShowCheckout] = useState<CopyRow | null>(null);
  const [borrowerType, setBorrowerType] = useState<"student" | "staff">("student");
  const [borrowerSearch, setBorrowerSearch] = useState("");
  const [selectedBorrower, setSelectedBorrower] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  });
  const [checkingOut, setCheckingOut] = useState(false);
  const [returning, setReturning] = useState<string | null>(null);

  const availableStudents = useMemo(
    () => students.filter((s) => s.full_name.toLowerCase().includes(borrowerSearch.toLowerCase())),
    [students, borrowerSearch]
  );
  const availableStaff = useMemo(
    () => staff.filter((s) => s.full_name.toLowerCase().includes(borrowerSearch.toLowerCase())),
    [staff, borrowerSearch]
  );

  function openCheckout(copy: CopyRow) {
    setShowCheckout(copy);
    setBorrowerType("student");
    setBorrowerSearch("");
    setSelectedBorrower("");
    const d = new Date();
    d.setDate(d.getDate() + 14);
    setDueDate(d.toISOString().slice(0, 10));
  }

  async function confirmCheckout() {
    if (!showCheckout || !selectedBorrower) { notify("Select a borrower.", "error"); return; }
    setCheckingOut(true);
    try {
      const { error } = await supabase.rpc("library_checkout_copy", {
        p_copy_id: showCheckout.id,
        p_student_id: borrowerType === "student" ? selectedBorrower : null,
        p_staff_id: borrowerType === "staff" ? selectedBorrower : null,
        p_due_date: dueDate,
      });
      if (error) throw error;
      notify("Book checked out.");
      setShowCheckout(null);
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Checkout failed."), "error");
    } finally {
      setCheckingOut(false);
    }
  }

  async function returnLoan(loan: LoanRow) {
    setReturning(loan.id);
    try {
      const { data, error } = await supabase.rpc("library_return_copy", {
        p_loan_id: loan.id,
        p_fine_per_day: FINE_PER_DAY,
      }).maybeSingle();
      if (error) throw error;
      const result = data as { fine_result: number; days_late_result: number };
      if (result.days_late_result > 0) {
        notify(`Returned — ${result.days_late_result} day${result.days_late_result === 1 ? "" : "s"} late, fine: ${fmtMoney(result.fine_result)}`, "info");
      } else {
        notify("Returned on time — thank you!");
      }
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Return failed."), "error");
    } finally {
      setReturning(null);
    }
  }

  async function toggleFinePaid(loan: LoanRow) {
    const { error } = await supabase.from("library_loans").update({ fine_paid: !loan.fine_paid }).eq("id", loan.id);
    if (error) { notify(extractErrorMessage(error, "Failed to update fine status."), "error"); return; }
    load();
  }

  /* ---------------- Reservations ---------------- */
  const [showReserve, setShowReserve] = useState<BookRow | null>(null);
  const [reserveType, setReserveType] = useState<"student" | "staff">("student");
  const [reserveSearch, setReserveSearch] = useState("");
  const [selectedReserver, setSelectedReserver] = useState<string>("");
  const [reserving, setReserving] = useState(false);

  async function confirmReserve() {
    if (!showReserve || !selectedReserver) { notify("Select who is reserving.", "error"); return; }
    setReserving(true);
    try {
      const { error } = await supabase.from("library_reservations").insert({
        book_id: showReserve.id,
        student_id: reserveType === "student" ? selectedReserver : null,
        staff_id: reserveType === "staff" ? selectedReserver : null,
        organization_id: orgId,
      });
      if (error) throw error;
      notify("Reservation added.");
      setShowReserve(null);
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Failed to reserve."), "error");
    } finally {
      setReserving(false);
    }
  }

  async function cancelReservation(r: ReservationRow) {
    const { error } = await supabase.from("library_reservations").update({ status: "cancelled" }).eq("id", r.id);
    if (error) { notify(extractErrorMessage(error, "Failed to cancel."), "error"); return; }
    load();
  }

  async function fulfillReservation(r: ReservationRow) {
    const availableCopy = (copiesByBook[r.book_id] || []).find((c) => c.status === "available");
    if (!availableCopy) { notify("No available copy for this title yet.", "error"); return; }
    try {
      const { error: rpcError } = await supabase.rpc("library_checkout_copy", {
        p_copy_id: availableCopy.id,
        p_student_id: r.student_id,
        p_staff_id: r.staff_id,
        p_due_date: null,
      });
      if (rpcError) throw rpcError;
      await supabase.from("library_reservations").update({ status: "fulfilled" }).eq("id", r.id);
      notify(`Checked out ${availableCopy.copy_code} to fulfil the reservation.`);
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Failed to fulfil reservation."), "error");
    }
  }

  /* ---------------- Filtering ---------------- */
  const filteredBooks = books.filter((b) =>
    b.status === "active" && (
      b.title.toLowerCase().includes(search.toLowerCase()) ||
      (b.author || "").toLowerCase().includes(search.toLowerCase()) ||
      (b.isbn || "").toLowerCase().includes(search.toLowerCase())
    )
  );
  const activeLoans = loans.filter((l) => l.status === "active");
  const overdueLoans = activeLoans.filter((l) => l.due_date < new Date().toISOString().slice(0, 10));
  const pendingReservations = reservations.filter((r) => r.status === "pending");

  const TABS: TabDef<Tab>[] = [
    { key: "catalogue", label: "Catalogue", icon: <BookOpen size={14} /> },
    { key: "loans", label: "Active Loans", icon: <ArrowLeftRight size={14} />, count: activeLoans.length },
    { key: "reservations", label: "Reservations", icon: <Bookmark size={14} />, count: pendingReservations.length },
    { key: "overdue", label: "Overdue", icon: <AlertTriangle size={14} />, count: overdueLoans.length },
  ];

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="Library"
        subtitle="Catalogue, loans, reservations, and overdue tracking."
        eyebrow="Operations"
        icon={<BookOpen size={22} />}
        gradient="amber"
        breadcrumb={[{ label: "Operations" }, { label: "Library" }]}
      >
        {tab === "catalogue" && books.length > 0 && (
          <Button variant="secondary" onClick={() => exportRowsAsCsv(`library-books-${new Date().toISOString().slice(0,10)}.csv`, books, [
            { key: "book_code", label: "Code" }, { key: "title", label: "Title" },
            { key: "author", label: "Author" }, { key: "isbn", label: "ISBN" },
            { key: "category", label: "Category" }, { key: "total_copies", label: "Total copies" },
          ])}><Download size={14} /> Export</Button>
        )}
        {canEdit && tab === "catalogue" && (
          <Button variant="gold" onClick={() => openBookForm()}><Plus size={16} /> Add Book</Button>
        )}
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KpiCard label="Titles" value={String(stats.total_titles)} icon={<Layers size={18} />} />
        <KpiCard label="Copies" value={String(stats.total_copies)} icon={<BookOpen size={18} />} />
        <KpiCard label="Available" value={String(stats.available_copies)} icon={<CheckCircle2 size={18} />} colorClass="text-emerald-600" />
        <KpiCard label="Active Loans" value={String(stats.active_loans)} icon={<ArrowLeftRight size={18} />} />
        <KpiCard label="Overdue" value={String(stats.overdue_loans)} icon={<AlertTriangle size={18} />} colorClass={stats.overdue_loans > 0 ? "text-red-600" : "text-[#0F2A47]"} />
      </div>

      <Tabs<Tab> tabs={TABS} value={tab} onChange={setTab} />

      {loading ? <LoadingSpinner /> : (
        <>
          {tab === "catalogue" && (
            <div className="space-y-4">
              <div className="relative max-w-sm">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search title, author, ISBN…"
                  className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
                />
              </div>

              {filteredBooks.length === 0 ? (
                <SetupHero
                  icon={<BookOpen size={40} />}
                  title="Build your library catalogue"
                  description="Add books, track copies, lend them to students and staff, and see who's overdue at a glance. Reservations queue automatically when all copies are out."
                  bullets={[
                    "Multi-copy tracking per title",
                    "One-click check-out and return",
                    "Overdue alerts with days-late count",
                    "Reservations queue when everything is loaned",
                  ]}
                  tone="amber"
                  primaryCta={canEdit ? { label: "Add your first book", onClick: () => openBookForm() } : { label: "Editors only", onClick: () => {}, disabled: true }}
                />
              ) : (
                <div className="space-y-3">
                  {filteredBooks.map((b) => {
                    const bookCopies = copiesByBook[b.id] || [];
                    const availableCount = bookCopies.filter((c) => c.status === "available").length;
                    const expanded = expandedBook === b.id;
                    return (
                      <Card key={b.id}>
                        <div className="flex items-start justify-between gap-3 cursor-pointer" onClick={() => setExpandedBook(expanded ? null : b.id)}>
                          <div className="flex items-start gap-3">
                            <div className="w-9 h-12 rounded shrink-0" style={{ backgroundColor: b.cover_color }} />
                            <div>
                              <h3 className="font-semibold text-[#0F2A47] text-sm">{b.title}</h3>
                              <p className="text-xs text-gray-500">{b.author || "Unknown author"}{b.category ? ` · ${b.category}` : ""}</p>
                              <p className="text-xs text-gray-400 mt-0.5">{bookCopies.length} cop{bookCopies.length === 1 ? "y" : "ies"} · {availableCount} available</p>
                            </div>
                          </div>
                          {canEdit && (
                            <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                              {availableCount === 0 && bookCopies.length > 0 && (
                                <Button variant="secondary" size="sm" onClick={() => setShowReserve(b)}><Bookmark size={12} /> Reserve</Button>
                              )}
                              <button onClick={() => openBookForm(b)} title="Edit" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><Pencil size={14} /></button>
                              <button onClick={() => retireBook(b)} title="Retire" className="p-1.5 rounded-lg hover:bg-red-50 text-red-500"><Trash2 size={14} /></button>
                            </div>
                          )}
                        </div>

                        {expanded && (
                          <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                            {b.description && <p className="text-xs text-gray-500">{b.description}</p>}
                            <div className="flex items-center justify-between">
                              <h4 className="text-xs font-bold text-gray-600 uppercase tracking-wide">Copies</h4>
                              {canEdit && (
                                <button onClick={() => setAddingCopyFor(b)} className="text-xs text-[#0F2A47] hover:text-[#C9A227] flex items-center gap-1"><Plus size={12} /> Add copy</button>
                              )}
                            </div>
                            {bookCopies.length === 0 ? (
                              <p className="text-xs text-gray-400 italic">No physical copies yet.</p>
                            ) : (
                              <div className="space-y-1">
                                {bookCopies.map((c) => (
                                  <div key={c.id} className="flex items-center justify-between text-xs bg-gray-50 rounded-lg px-3 py-2">
                                    <span className="text-gray-600">{c.copy_code}{c.shelf_location ? ` · ${c.shelf_location}` : ""} · {c.condition}</span>
                                    <div className="flex items-center gap-2">
                                      <span className={cn(
                                        "text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full",
                                        c.status === "available" ? "bg-emerald-100 text-emerald-700" :
                                        c.status === "borrowed" ? "bg-amber-100 text-amber-700" : "bg-gray-200 text-gray-600"
                                      )}>{c.status}</span>
                                      {canEdit && c.status === "available" && (
                                        <button onClick={() => openCheckout(c)} className="text-[#0F2A47] hover:text-[#C9A227] font-medium">Check out</button>
                                      )}
                                      {canEdit && c.status !== "borrowed" && (
                                        <button onClick={() => retireCopy(c)} className="text-red-400 hover:text-red-600"><Trash2 size={12} /></button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === "loans" && (
            activeLoans.length === 0 ? (
              <EmptyState message="No active loans." icon={<ArrowLeftRight size={40} />} />
            ) : (
              <div className="space-y-2">
                {activeLoans.map((l) => {
                  const copy = copyById.get(l.copy_id);
                  const book = copy ? bookById.get(copy.book_id) : null;
                  const isOverdue = l.due_date < new Date().toISOString().slice(0, 10);
                  return (
                    <Card key={l.id} className="flex items-center justify-between !p-3.5">
                      <div>
                        <p className="text-sm font-medium text-gray-700">{book?.title || "Unknown title"} <span className="text-xs text-gray-400">({copy?.copy_code})</span></p>
                        <p className="text-xs text-gray-500">{borrowerLabel(l)}</p>
                        <p className={cn("text-xs mt-0.5", isOverdue ? "text-red-600 font-medium" : "text-gray-400")}>Due {fmtDate(l.due_date)}{isOverdue ? " · overdue" : ""}</p>
                      </div>
                      {canEdit && (
                        <Button variant="secondary" size="sm" onClick={() => returnLoan(l)} loading={returning === l.id}>Return</Button>
                      )}
                    </Card>
                  );
                })}
              </div>
            )
          )}

          {tab === "reservations" && (
            pendingReservations.length === 0 ? (
              <EmptyState message="No pending reservations." icon={<Bookmark size={40} />} />
            ) : (
              <div className="space-y-2">
                {pendingReservations.map((r) => {
                  const book = bookById.get(r.book_id);
                  const hasAvailable = (copiesByBook[r.book_id] || []).some((c) => c.status === "available");
                  return (
                    <Card key={r.id} className="flex items-center justify-between !p-3.5">
                      <div>
                        <p className="text-sm font-medium text-gray-700">{book?.title || "Unknown title"}</p>
                        <p className="text-xs text-gray-500">{borrowerLabel(r)} · reserved {fmtDate(r.reserved_at)}</p>
                      </div>
                      {canEdit && (
                        <div className="flex items-center gap-2">
                          {hasAvailable && <Button variant="gold" size="sm" onClick={() => fulfillReservation(r)}>Fulfil</Button>}
                          <button onClick={() => cancelReservation(r)} className="text-red-400 hover:text-red-600 text-xs">Cancel</button>
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            )
          )}

          {tab === "overdue" && (
            overdueLoans.length === 0 ? (
              <EmptyState message="Nothing overdue — great job!" icon={<CheckCircle2 size={40} />} />
            ) : (
              <div className="space-y-2">
                {overdueLoans.map((l) => {
                  const copy = copyById.get(l.copy_id);
                  const book = copy ? bookById.get(copy.book_id) : null;
                  const daysLate = Math.floor((Date.now() - new Date(l.due_date).getTime()) / 86400000);
                  const estFine = daysLate * FINE_PER_DAY;
                  return (
                    <Card key={l.id} className="flex items-center justify-between !p-3.5 border-red-100">
                      <div>
                        <p className="text-sm font-medium text-gray-700">{book?.title || "Unknown title"} <span className="text-xs text-gray-400">({copy?.copy_code})</span></p>
                        <p className="text-xs text-gray-500">{borrowerLabel(l)}</p>
                        <p className="text-xs text-red-600 font-medium mt-0.5">{daysLate} day{daysLate === 1 ? "" : "s"} overdue · est. fine {fmtMoney(estFine)}</p>
                      </div>
                      {canEdit && (
                        <Button variant="danger" size="sm" onClick={() => returnLoan(l)} loading={returning === l.id}>Return &amp; Fine</Button>
                      )}
                    </Card>
                  );
                })}
              </div>
            )
          )}
        </>
      )}

      {/* Fines ledger (only meaningful once there are returned loans with a fine) */}
      {tab === "loans" && loans.some((l) => l.status === "returned" && l.fine_amount > 0) && (
        <Card>
          <h3 className="text-xs font-bold text-gray-600 uppercase tracking-wide mb-2">Unpaid Fines</h3>
          <div className="space-y-1">
            {loans.filter((l) => l.status === "returned" && l.fine_amount > 0 && !l.fine_paid).map((l) => {
              const copy = copyById.get(l.copy_id);
              const book = copy ? bookById.get(copy.book_id) : null;
              return (
                <div key={l.id} className="flex items-center justify-between text-xs py-1.5 px-2 rounded-md odd:bg-gray-50">
                  <span>{borrowerLabel(l)} · {book?.title}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-red-600">{fmtMoney(l.fine_amount)}</span>
                    {canEdit && <button onClick={() => toggleFinePaid(l)} className="text-[#0F2A47] hover:text-[#C9A227]">Mark paid</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Book form */}
      <Modal open={showBookForm} onClose={() => setShowBookForm(false)} title={editingBook ? "Edit Book" : "Add Book"} size="lg">
        <div className="space-y-3">
          <Input label="Title" value={bookForm.title} onChange={(e) => setBookForm({ ...bookForm, title: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Author" value={bookForm.author} onChange={(e) => setBookForm({ ...bookForm, author: e.target.value })} />
            <Input label="ISBN" value={bookForm.isbn} onChange={(e) => setBookForm({ ...bookForm, isbn: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Publisher" value={bookForm.publisher} onChange={(e) => setBookForm({ ...bookForm, publisher: e.target.value })} />
            <Input label="Category" value={bookForm.category} onChange={(e) => setBookForm({ ...bookForm, category: e.target.value })} placeholder="e.g. Fiction" />
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Description</label>
            <textarea
              value={bookForm.description}
              onChange={(e) => setBookForm({ ...bookForm, description: e.target.value })}
              rows={3}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Cover color</label>
            <div className="flex gap-2">
              {COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setBookForm({ ...bookForm, cover_color: color })}
                  className={cn("w-7 h-7 rounded-full border-2", bookForm.cover_color === color ? "border-[#0F2A47] scale-110" : "border-transparent")}
                  style={{ backgroundColor: color }}
                  aria-label={color}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowBookForm(false)}>Cancel</Button>
            <Button variant="gold" onClick={saveBook} loading={savingBook}>{editingBook ? "Save Changes" : "Add Book"}</Button>
          </div>
        </div>
      </Modal>

      {/* Add copy */}
      <Modal open={!!addingCopyFor} onClose={() => setAddingCopyFor(null)} title={`Add Copy — ${addingCopyFor?.title ?? ""}`}>
        <div className="space-y-3">
          <Input label="Shelf location (optional)" value={copyShelf} onChange={(e) => setCopyShelf(e.target.value)} placeholder="e.g. Shelf B3" />
          <p className="text-xs text-gray-400">A copy code will be generated automatically (e.g. LIB-0007).</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setAddingCopyFor(null)}>Cancel</Button>
            <Button variant="gold" onClick={addCopy} loading={savingCopy}>Add Copy</Button>
          </div>
        </div>
      </Modal>

      {/* Checkout */}
      <Modal open={!!showCheckout} onClose={() => setShowCheckout(null)} title={`Check Out — ${showCheckout?.copy_code ?? ""}`} size="lg">
        <div className="space-y-3">
          <div className="flex gap-2">
            <button onClick={() => { setBorrowerType("student"); setSelectedBorrower(""); }} className={cn("flex-1 px-3 py-2 rounded-lg border text-sm font-medium", borrowerType === "student" ? "bg-[#0F2A47] text-white border-[#0F2A47]" : "bg-white border-gray-200 text-gray-600")}>Student</button>
            <button onClick={() => { setBorrowerType("staff"); setSelectedBorrower(""); }} className={cn("flex-1 px-3 py-2 rounded-lg border text-sm font-medium", borrowerType === "staff" ? "bg-[#0F2A47] text-white border-[#0F2A47]" : "bg-white border-gray-200 text-gray-600")}>Staff</button>
          </div>
          <Input placeholder="Search…" value={borrowerSearch} onChange={(e) => setBorrowerSearch(e.target.value)} />
          <div className="max-h-48 overflow-y-auto space-y-1 border border-gray-100 rounded-lg p-1.5">
            {(borrowerType === "student" ? availableStudents : availableStaff).slice(0, 30).map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedBorrower(p.id)}
                className={cn("w-full text-left px-2.5 py-1.5 rounded-md text-sm", selectedBorrower === p.id ? "bg-[#FFFBEB] border border-[#C9A227]" : "hover:bg-gray-50")}
              >
                {p.full_name} <span className="text-xs text-gray-400">{borrowerType === "student" ? (p as StudentOption).student_code : (p as StaffOption).staff_code}</span>
              </button>
            ))}
          </div>
          <Input label="Due date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowCheckout(null)}>Cancel</Button>
            <Button variant="gold" onClick={confirmCheckout} loading={checkingOut}>Check Out</Button>
          </div>
        </div>
      </Modal>

      {/* Reserve */}
      <Modal open={!!showReserve} onClose={() => setShowReserve(null)} title={`Reserve — ${showReserve?.title ?? ""}`} size="lg">
        <div className="space-y-3">
          <div className="flex gap-2">
            <button onClick={() => { setReserveType("student"); setSelectedReserver(""); }} className={cn("flex-1 px-3 py-2 rounded-lg border text-sm font-medium", reserveType === "student" ? "bg-[#0F2A47] text-white border-[#0F2A47]" : "bg-white border-gray-200 text-gray-600")}>Student</button>
            <button onClick={() => { setReserveType("staff"); setSelectedReserver(""); }} className={cn("flex-1 px-3 py-2 rounded-lg border text-sm font-medium", reserveType === "staff" ? "bg-[#0F2A47] text-white border-[#0F2A47]" : "bg-white border-gray-200 text-gray-600")}>Staff</button>
          </div>
          <Input placeholder="Search…" value={reserveSearch} onChange={(e) => setReserveSearch(e.target.value)} />
          <div className="max-h-48 overflow-y-auto space-y-1 border border-gray-100 rounded-lg p-1.5">
            {(reserveType === "student" ? students.filter((s) => s.full_name.toLowerCase().includes(reserveSearch.toLowerCase())) : staff.filter((s) => s.full_name.toLowerCase().includes(reserveSearch.toLowerCase()))).slice(0, 30).map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedReserver(p.id)}
                className={cn("w-full text-left px-2.5 py-1.5 rounded-md text-sm", selectedReserver === p.id ? "bg-[#FFFBEB] border border-[#C9A227]" : "hover:bg-gray-50")}
              >
                {p.full_name}
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowReserve(null)}>Cancel</Button>
            <Button variant="gold" onClick={confirmReserve} loading={reserving}>Reserve</Button>
          </div>
        </div>
      </Modal>

      <ToastHost />
    </div>
  );
}
