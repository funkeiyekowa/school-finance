"use client";

/**
 * Enquiries and leads.
 *
 * Everything submitted through the public website lands here: contact
 * messages, admission enquiries, prospectus requests and tour bookings.
 * Rows are tenant-scoped by RLS — a visitor can write a submission but never
 * read one, and one school can never see another's enquiries.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/lib/hooks/useToast";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { cn, fmtDateTime } from "@/lib/utils";
import {
  Inbox, Mail, Phone, AlertTriangle, Search, Trash2, ShieldAlert,
} from "lucide-react";

interface Submission {
  id: string;
  form_key: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  subject: string | null;
  message: string | null;
  data: Record<string, unknown>;
  status: string;
  notes: string | null;
  source_page: string | null;
  is_spam: boolean;
  created_at: string;
}

const STATUSES = [
  { value: "new", label: "New", variant: "blue" as const },
  { value: "contacted", label: "Contacted", variant: "amber" as const },
  { value: "qualified", label: "Qualified", variant: "purple" as const },
  { value: "converted", label: "Converted", variant: "green" as const },
  { value: "closed", label: "Closed", variant: "gray" as const },
];

export default function LeadsPage() {
  return (
    <Suspense fallback={<div className="p-6"><LoadingSpinner /></div>}>
      <LeadsPageInner />
    </Suspense>
  );
}

function LeadsPageInner() {
  const supabase = useMemo(() => createClient(), []);
  const searchParams = useSearchParams();
  const { notify, ToastHost } = useToast();

  const [rows, setRows] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>(() => searchParams.get("status") || "all");
  const [formFilter, setFormFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Submission | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from("website_submissions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    if (err) {
      setError(
        err.message.includes("does not exist")
          ? "The website tables are missing. Run supabase/website_module.sql first."
          : err.message
      );
      setRows([]);
    } else {
      setRows((data ?? []) as Submission[]);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  async function setStatus(row: Submission, status: string) {
    setBusy(true);
    const { error: err } = await supabase
      .from("website_submissions").update({ status }).eq("id", row.id);
    setBusy(false);
    if (err) { notify(`Could not update status: ${err.message}`, "error"); return; }
    setRows(rs => rs.map(r => (r.id === row.id ? { ...r, status } : r)));
    if (open?.id === row.id) setOpen({ ...open, status });
    notify("Status updated");
  }

  async function saveNotes(row: Submission) {
    setBusy(true);
    const { error: err } = await supabase.from("website_submissions").update({ notes }).eq("id", row.id);
    setBusy(false);
    if (err) { notify(`Could not save notes: ${err.message}`, "error"); return; }
    setRows(rs => rs.map(r => (r.id === row.id ? { ...r, notes } : r)));
    setOpen(null);
    notify("Notes saved");
  }

  async function markSpam(row: Submission) {
    const { error: err } = await supabase.from("website_submissions")
      .update({ is_spam: !row.is_spam, status: row.is_spam ? "new" : "closed" })
      .eq("id", row.id);
    if (err) { notify(`Could not update: ${err.message}`, "error"); return; }
    notify(row.is_spam ? "Marked as not spam" : "Marked as spam");
    load();
  }

  async function remove(row: Submission) {
    if (!confirm("Delete this enquiry permanently?")) return;
    const { error: err } = await supabase.from("website_submissions").delete().eq("id", row.id);
    if (err) { notify(`Could not delete: ${err.message}`, "error"); return; }
    setOpen(null);
    notify("Enquiry deleted");
    load();
  }

  const formKeys = Array.from(new Set(rows.map(r => r.form_key).filter(Boolean))) as string[];

  const visible = rows.filter(r => {
    if (filter === "all" ? r.is_spam : filter === "spam" ? !r.is_spam : r.status !== filter || r.is_spam) {
      if (filter !== "all" && filter !== "spam") return false;
      if (filter === "all" && r.is_spam) return false;
      if (filter === "spam" && !r.is_spam) return false;
    }
    if (formFilter !== "all" && r.form_key !== formFilter) return false;
    if (query.trim()) {
      const q = query.toLowerCase();
      const hay = [r.contact_name, r.contact_email, r.subject, r.message]
        .filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const counts = STATUSES.map(s => ({
    ...s,
    count: rows.filter(r => r.status === s.value && !r.is_spam).length,
  }));

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="Enquiries"
        subtitle="Messages and applications from your public website"
      />

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
          <AlertTriangle size={15} className="mt-px shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {counts.map(s => (
          <button
            key={s.value}
            onClick={() => setFilter(filter === s.value ? "all" : s.value)}
            className={cn(
              "rounded-lg border p-3 text-left transition-colors",
              filter === s.value ? "border-[#C9A227] bg-[#FBF6E8]" : "border-gray-200 hover:bg-gray-50"
            )}
          >
            <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-500">
              {s.label}
            </span>
            <span className="block text-xl font-bold text-[#0F2A47] mt-0.5">{s.count}</span>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>
              {filter === "spam" ? "Spam" : "Enquiries"} ({visible.length})
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 border border-gray-300 rounded-lg px-2.5 py-1.5">
                <Search size={13} className="text-gray-400" />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search"
                  aria-label="Search enquiries"
                  className="text-sm outline-none w-36"
                />
              </div>
              {formKeys.length > 1 && (
                <select
                  value={formFilter}
                  onChange={e => setFormFilter(e.target.value)}
                  aria-label="Filter by form"
                  className="text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 bg-white"
                >
                  <option value="all">All forms</option>
                  {formKeys.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              )}
              <Button
                size="sm"
                variant={filter === "spam" ? "gold" : "secondary"}
                onClick={() => setFilter(filter === "spam" ? "all" : "spam")}
              >
                <ShieldAlert size={13} /> Spam
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {visible.length === 0 ? (
            <div className="py-12 text-center">
              <Inbox size={32} className="mx-auto text-gray-300 mb-3" />
              <p className="text-sm text-gray-500">
                {rows.length === 0
                  ? "No enquiries yet. They arrive here once your website is published and someone uses a form."
                  : "Nothing matches these filters."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">From</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Form</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Subject</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Status</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Received</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map(r => (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-3 py-2">
                        <div className="font-medium">{r.contact_name || "—"}</div>
                        <div className="text-xs text-gray-500">{r.contact_email}</div>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500">{r.form_key ?? "—"}</td>
                      <td className="px-3 py-2 max-w-xs">
                        <span className="block truncate">
                          {r.subject || r.message || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={STATUSES.find(s => s.value === r.status)?.variant ?? "gray"}>
                          {r.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-400">{fmtDateTime(r.created_at)}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => { setOpen(r); setNotes(r.notes ?? ""); }}
                          className="text-xs text-[#0F2A47] hover:underline"
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {open && (
        <Modal open onClose={() => setOpen(null)} title={open.subject || "Enquiry"} size="lg">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-4 text-sm">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-gray-500">From</p>
                <p className="font-medium">{open.contact_name || "—"}</p>
              </div>
              {open.contact_email && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Email</p>
                  <a href={`mailto:${open.contact_email}`}
                     className="text-[#0F2A47] hover:underline inline-flex items-center gap-1">
                    <Mail size={12} /> {open.contact_email}
                  </a>
                </div>
              )}
              {open.contact_phone && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Phone</p>
                  <a href={`tel:${open.contact_phone}`}
                     className="text-[#0F2A47] hover:underline inline-flex items-center gap-1">
                    <Phone size={12} /> {open.contact_phone}
                  </a>
                </div>
              )}
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Received</p>
                <p>{fmtDateTime(open.created_at)}</p>
              </div>
            </div>

            {open.message && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1">Message</p>
                <p className="text-sm whitespace-pre-wrap bg-gray-50 rounded-lg p-3">{open.message}</p>
              </div>
            )}

            {/* Any extra fields the form collected beyond the standard ones. */}
            {Object.entries(open.data ?? {}).filter(
              ([k]) => !["name", "email", "phone", "subject", "message"].includes(k)
            ).length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1">
                  Other answers
                </p>
                <dl className="text-sm bg-gray-50 rounded-lg p-3 space-y-1">
                  {Object.entries(open.data ?? {})
                    .filter(([k]) => !["name", "email", "phone", "subject", "message"].includes(k))
                    .map(([k, v]) => (
                      <div key={k} className="flex gap-2">
                        <dt className="font-semibold capitalize">{k.replace(/_/g, " ")}:</dt>
                        <dd>{String(v)}</dd>
                      </div>
                    ))}
                </dl>
              </div>
            )}

            <div>
              <label htmlFor="lead-status" className="block text-sm font-medium text-gray-700 mb-1">
                Status
              </label>
              <select
                id="lead-status"
                value={open.status}
                onChange={e => setStatus(open, e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white"
              >
                {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>

            <div>
              <label htmlFor="lead-notes" className="block text-sm font-medium text-gray-700 mb-1">
                Internal notes
              </label>
              <textarea
                id="lead-notes"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                placeholder="Called on Tuesday, tour booked for Friday."
              />
            </div>

            {open.source_page && (
              <p className="text-xs text-gray-500">Submitted from {open.source_page}</p>
            )}

            <div className="flex flex-wrap justify-between gap-2 pt-2 border-t border-gray-100">
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => markSpam(open)}>
                  <ShieldAlert size={13} /> {open.is_spam ? "Not spam" : "Mark spam"}
                </Button>
                <Button size="sm" variant="danger" onClick={() => remove(open)}>
                  <Trash2 size={13} /> Delete
                </Button>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setOpen(null)}>Close</Button>
                <Button variant="gold" loading={busy} onClick={() => saveNotes(open)}>
                  Save notes
                </Button>
              </div>
            </div>
          </div>
        </Modal>
      )}
      <ToastHost />
    </div>
  );
}
