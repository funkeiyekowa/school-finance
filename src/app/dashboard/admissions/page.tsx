"use client";

/**
 * /dashboard/admissions
 *
 * The middle of the funnel. `leads` (website_submissions) captures
 * enquiries and `students` holds those already enrolled — this tracks
 * everything between: reviewing an applicant, making an offer, and
 * turning an accepted offer into a real student record.
 *
 *   new -> reviewing -> offered -> accepted -> enrolled
 *                    \-> rejected      \-> withdrawn
 *
 * Admitting calls the `admit_application` RPC, which creates the student
 * row, links it back, and closes the originating enquiry in one step.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtDate, cn } from "@/lib/utils";
import { PageHeader, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/lib/hooks/useToast";
import { ClipboardList, Plus, Search, UserCheck } from "lucide-react";

type AdmissionStatus =
  | "new" | "reviewing" | "offered" | "accepted"
  | "enrolled" | "rejected" | "withdrawn";

interface Application {
  id: string;
  organization_id: string;
  reference: string | null;
  applicant_name: string;
  date_of_birth: string | null;
  gender: string | null;
  applying_for: string | null;
  address: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  guardian_email: string | null;
  source: string;
  submission_id: string | null;
  status: AdmissionStatus;
  notes: string | null;
  decision_notes: string | null;
  student_id: string | null;
  created_at: string;
}

const STATUS_META: Record<
  AdmissionStatus,
  { label: string; variant: "gray" | "blue" | "amber" | "green" | "red" | "purple" }
> = {
  new: { label: "New", variant: "blue" },
  reviewing: { label: "Reviewing", variant: "amber" },
  offered: { label: "Offered", variant: "purple" },
  accepted: { label: "Accepted", variant: "green" },
  enrolled: { label: "Enrolled", variant: "green" },
  rejected: { label: "Rejected", variant: "red" },
  withdrawn: { label: "Withdrawn", variant: "gray" },
};

/** Which statuses a row can legally move to next. */
const NEXT_STATUSES: Record<AdmissionStatus, AdmissionStatus[]> = {
  new: ["reviewing", "rejected"],
  reviewing: ["offered", "rejected"],
  offered: ["accepted", "rejected", "withdrawn"],
  accepted: [],           // -> enrolled happens via admit_application
  enrolled: [],
  rejected: ["reviewing"],
  withdrawn: ["reviewing"],
};

const TABS: { key: string; label: string; match: (a: Application) => boolean }[] = [
  { key: "open", label: "In progress", match: (a) => !["enrolled", "rejected", "withdrawn"].includes(a.status) },
  { key: "new", label: "New", match: (a) => a.status === "new" },
  { key: "offered", label: "Offered", match: (a) => a.status === "offered" },
  { key: "accepted", label: "Accepted", match: (a) => a.status === "accepted" },
  { key: "enrolled", label: "Enrolled", match: (a) => a.status === "enrolled" },
  { key: "closed", label: "Closed", match: (a) => a.status === "rejected" || a.status === "withdrawn" },
  { key: "all", label: "All", match: () => true },
];

const EMPTY_FORM = {
  applicant_name: "", date_of_birth: "", gender: "", applying_for: "",
  guardian_name: "", guardian_phone: "", guardian_email: "", address: "", notes: "",
};

export default function AdmissionsPage() {
  const { profile, orgId, canEdit } = useAuth();
  const supabase = createClient();
  const { notify, ToastHost } = useToast();

  const [rows, setRows] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("open");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [admitting, setAdmitting] = useState<Application | null>(null);
  const [studentCode, setStudentCode] = useState("");
  const [academicYear, setAcademicYear] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("admission_applications")
      .select("*")
      .order("created_at", { ascending: false });
    if (orgId) q = q.eq("organization_id", orgId);
    const { data, error } = await q;
    if (error) notify(`Could not load applications: ${error.message}`, "error");
    setRows((data ?? []) as Application[]);
    setLoading(false);
  }, [supabase, notify, orgId]);

  useEffect(() => { load(); }, [load]);

  const tabCounts = useMemo(() => {
    const c: Record<string, number> = {};
    TABS.forEach((t) => { c[t.key] = rows.filter(t.match).length; });
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const t = TABS.find((x) => x.key === tab) ?? TABS[0];
    const q = search.trim().toLowerCase();
    return rows.filter(t.match).filter((a) =>
      !q ||
      a.applicant_name.toLowerCase().includes(q) ||
      (a.reference ?? "").toLowerCase().includes(q) ||
      (a.guardian_name ?? "").toLowerCase().includes(q) ||
      (a.applying_for ?? "").toLowerCase().includes(q)
    );
  }, [rows, tab, search]);

  async function createApplication() {
    if (!form.applicant_name.trim()) { notify("Applicant name is required.", "error"); return; }
    if (!orgId) { notify("No organization in scope — reload and try again.", "error"); return; }
    setSaving(true);
    const { error } = await supabase.from("admission_applications").insert({
      organization_id: orgId,
      applicant_name: form.applicant_name.trim(),
      date_of_birth: form.date_of_birth || null,
      gender: form.gender || null,
      applying_for: form.applying_for.trim() || null,
      guardian_name: form.guardian_name.trim() || null,
      guardian_phone: form.guardian_phone.trim() || null,
      guardian_email: form.guardian_email.trim() || null,
      address: form.address.trim() || null,
      notes: form.notes.trim() || null,
      source: "manual",
    });
    setSaving(false);
    if (error) { notify(`Could not create application: ${error.message}`, "error"); return; }
    notify("Application created");
    setShowForm(false);
    setForm(EMPTY_FORM);
    load();
  }

  async function move(a: Application, status: AdmissionStatus) {
    setBusyId(a.id);
    const { error } = await supabase
      .from("admission_applications")
      .update({ status })
      .eq("id", a.id);
    setBusyId(null);
    if (error) { notify(`Update failed: ${error.message}`, "error"); return; }

    await supabase.from("activity_log").insert({
      user_email: profile?.email,
      user_name: profile?.full_name,
      action: "Update Admission",
      details: `${a.reference ?? a.applicant_name} → ${status}`,
      organization_id: a.organization_id,
    });
    notify(`${a.reference ?? "Application"} moved to ${STATUS_META[status].label.toLowerCase()}`);
    load();
  }

  async function admit() {
    if (!admitting) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("admit_application", {
      p_application_id: admitting.id,
      p_student_code: studentCode.trim() || null,
      p_academic_year: academicYear.trim() || null,
    });
    setSaving(false);
    if (error) { notify(`Could not admit: ${error.message}`, "error"); return; }

    const res = data as { ok?: boolean; student_code?: string; already_admitted?: boolean } | null;
    if (!res?.ok) { notify("Admission was rejected.", "error"); return; }

    await supabase.from("activity_log").insert({
      user_email: profile?.email,
      user_name: profile?.full_name,
      action: "Admit Applicant",
      details: `${admitting.reference ?? admitting.applicant_name} → student ${res.student_code ?? ""}`.trim(),
      organization_id: admitting.organization_id,
    });

    notify(
      res.already_admitted
        ? "That applicant was already admitted."
        : `Admitted as ${res.student_code}`
    );
    setAdmitting(null);
    setStudentCode("");
    setAcademicYear("");
    load();
  }

  if (loading) return <LoadingSpinner />;

  return (
    <div className="p-6">
      <PageHeader
        title="Admissions"
        subtitle="Applicants from enquiry through to an enrolled student."
        icon={<ClipboardList size={20} />}
      >
        {canEdit && (
          <Button variant="gold" onClick={() => setShowForm(true)}>
            <Plus size={14} /> New application
          </Button>
        )}
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
              tab === t.key ? "bg-[#0F2A47] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            )}
          >
            {t.label}<span className="ml-1.5 opacity-70">{tabCounts[t.key] ?? 0}</span>
          </button>
        ))}
        <div className="relative ml-auto">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, reference, guardian…"
            className="rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm w-72 focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={28} />}
          message="No applications here yet. Create one, or convert an enquiry from the Enquiries screen."
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((a) => {
            const meta = STATUS_META[a.status];
            const nexts = NEXT_STATUSES[a.status];
            return (
              <Card key={a.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-gray-500">{a.reference ?? "—"}</span>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                      {a.source !== "manual" && <Badge variant="gray">{a.source}</Badge>}
                    </div>
                    <div className="font-semibold text-[#0F2A47] mt-1">{a.applicant_name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {a.applying_for ? `For ${a.applying_for} · ` : ""}
                      {a.guardian_name ? `Guardian: ${a.guardian_name}` : "No guardian on file"}
                      {a.guardian_phone ? ` · ${a.guardian_phone}` : ""}
                      {" · "}{fmtDate(a.created_at)}
                    </div>
                    {a.notes && <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">{a.notes}</p>}
                  </div>

                  {canEdit && (
                    <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                      {nexts.map((s) => (
                        <Button
                          key={s}
                          size="sm"
                          variant={s === "rejected" || s === "withdrawn" ? "ghost" : "secondary"}
                          disabled={busyId === a.id}
                          onClick={() => move(a, s)}
                        >
                          {STATUS_META[s].label}
                        </Button>
                      ))}
                      {a.status === "accepted" && (
                        <Button size="sm" variant="gold" onClick={() => setAdmitting(a)}>
                          <UserCheck size={12} /> Admit as student
                        </Button>
                      )}
                      {a.status === "enrolled" && a.student_id && (
                        <a
                          href={`/dashboard/students/${a.student_id}`}
                          className="text-xs text-[#0F2A47] underline underline-offset-2 px-2"
                        >
                          View student
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {showForm && (
        <Modal open onClose={() => setShowForm(false)} title="New application">
          <div className="space-y-3">
            <Field label="Applicant name" required>
              <input
                value={form.applicant_name}
                onChange={(e) => setForm((f) => ({ ...f, applicant_name: e.target.value }))}
                autoFocus
                className={inputCls}
              />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Date of birth">
                <input type="date" value={form.date_of_birth}
                  onChange={(e) => setForm((f) => ({ ...f, date_of_birth: e.target.value }))}
                  className={inputCls} />
              </Field>
              <Field label="Gender">
                <select value={form.gender}
                  onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value }))}
                  className={inputCls}>
                  <option value="">—</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
              </Field>
              <Field label="Applying for">
                <input value={form.applying_for} placeholder="e.g. JSS 1"
                  onChange={(e) => setForm((f) => ({ ...f, applying_for: e.target.value }))}
                  className={inputCls} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Guardian name">
                <input value={form.guardian_name}
                  onChange={(e) => setForm((f) => ({ ...f, guardian_name: e.target.value }))}
                  className={inputCls} />
              </Field>
              <Field label="Guardian phone">
                <input value={form.guardian_phone}
                  onChange={(e) => setForm((f) => ({ ...f, guardian_phone: e.target.value }))}
                  className={inputCls} />
              </Field>
            </div>
            <Field label="Guardian email">
              <input value={form.guardian_email} type="email"
                onChange={(e) => setForm((f) => ({ ...f, guardian_email: e.target.value }))}
                className={inputCls} />
            </Field>
            <Field label="Notes">
              <textarea value={form.notes} rows={3}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                className={inputCls} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button variant="gold" disabled={saving} onClick={createApplication}>
                {saving ? "Saving…" : "Create"}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {admitting && (
        <Modal open onClose={() => setAdmitting(null)} title={`Admit ${admitting.applicant_name}`}>
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              This creates a student record and closes the application. Leave the
              code blank to allocate the next one automatically.
            </p>
            <Field label="Student code">
              <input value={studentCode} placeholder="Auto (STU-0001)"
                onChange={(e) => setStudentCode(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Academic year">
              <input value={academicYear} placeholder="e.g. 2026/2027"
                onChange={(e) => setAcademicYear(e.target.value)} className={inputCls} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setAdmitting(null)}>Cancel</Button>
              <Button variant="gold" disabled={saving} onClick={admit}>
                <UserCheck size={14} /> {saving ? "Admitting…" : "Admit"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
      <ToastHost />
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#C9A227]";

function Field({
  label, required, children,
}: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-700 mb-1">
        {label}{required && <span className="text-red-500"> *</span>}
      </label>
      {children}
    </div>
  );
}
