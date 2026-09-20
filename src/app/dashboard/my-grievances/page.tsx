"use client";

/**
 * /dashboard/my-grievances
 *
 * Self-service grievance view for students and parents. A raiser can
 * draft an issue, keep editing it, then submit it — after which it
 * belongs to the school and becomes read-only here (RLS enforces this;
 * the UI just reflects it).
 *
 * A parent raising on a child's behalf picks the child. The list of
 * children comes from `get_my_parent_children()` — the RPC-first pattern
 * used elsewhere in the portals, so a parent whose `org_memberships` row
 * is missing still sees their children (see AUDIT_NOTES "S288").
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtDateTime } from "@/lib/utils";
import { PageHeader, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/lib/hooks/useToast";
import { MessageSquareWarning, Plus, Send, Trash2, Pencil } from "lucide-react";
import {
  type Grievance,
  type GrievanceCategory,
  GRIEVANCE_STATUS_META,
  GRIEVANCE_CATEGORY_LABELS,
  GRIEVANCE_SUBCATEGORIES,
} from "@/lib/types/grievances";

interface ChildOption { id: string; name: string }

const EMPTY_FORM = {
  subject: "",
  description: "",
  category: "academic" as GrievanceCategory,
  subcategory: "",
  student_id: "",
};

export default function MyGrievancesPage() {
  const { profile, orgId } = useAuth();
  const supabase = createClient();
  const { notify, ToastHost } = useToast();

  const [rows, setRows] = useState<Grievance[]>([]);
  const [children, setChildren] = useState<ChildOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Grievance | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("grievances")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) notify(`Could not load your grievances: ${error.message}`, "error");
    setRows((data ?? []) as Grievance[]);

    // Parents file on behalf of a child. Students raise for themselves, so
    // the picker simply stays empty for them.
    const { data: kids } = await supabase.rpc("get_my_parent_children");
    if (Array.isArray(kids)) {
      setChildren(
        (kids as { id?: string; student_id?: string; full_name?: string; name?: string }[])
          .map((k) => ({
            id: String(k.student_id ?? k.id ?? ""),
            name: String(k.full_name ?? k.name ?? "Child"),
          }))
          .filter((k) => k.id)
      );
    }
    setLoading(false);
  }, [supabase, notify]);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const c = { total: rows.length, open: 0, resolved: 0, rejected: 0 };
    for (const r of rows) {
      if (r.status === "resolved") c.resolved++;
      else if (r.status === "rejected") c.rejected++;
      else if (r.status !== "draft") c.open++;
    }
    return c;
  }, [rows]);

  function openNew() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function openEdit(g: Grievance) {
    setEditing(g);
    setForm({
      subject: g.subject,
      description: g.description ?? "",
      category: g.category,
      subcategory: g.subcategory ?? "",
      student_id: g.student_id ?? "",
    });
    setShowForm(true);
  }

  async function save(submitNow: boolean) {
    if (!form.subject.trim()) { notify("Give the grievance a subject.", "error"); return; }
    if (!orgId) { notify("No organization in scope — reload and try again.", "error"); return; }
    setSaving(true);

    const payload = {
      subject: form.subject.trim(),
      description: form.description.trim() || null,
      category: form.category,
      subcategory: form.subcategory.trim() || null,
      student_id: form.student_id || null,
      status: submitNow ? "submitted" : "draft",
    };

    const { error } = editing
      ? await supabase.from("grievances").update(payload).eq("id", editing.id)
      : await supabase.from("grievances").insert({
          ...payload,
          organization_id: orgId,
          raised_by: profile?.id,
        });

    setSaving(false);
    if (error) { notify(`Could not save: ${error.message}`, "error"); return; }
    notify(submitNow ? "Grievance submitted" : "Draft saved");
    setShowForm(false);
    load();
  }

  async function submitExisting(g: Grievance) {
    setBusyId(g.id);
    const { error } = await supabase
      .from("grievances")
      .update({ status: "submitted" })
      .eq("id", g.id);
    setBusyId(null);
    if (error) { notify(`Could not submit: ${error.message}`, "error"); return; }
    notify(`${g.reference ?? "Grievance"} submitted`);
    load();
  }

  async function discard(g: Grievance) {
    if (!confirm(`Discard this draft?\n\n"${g.subject}"\n\nThis cannot be undone.`)) return;
    setBusyId(g.id);
    const { error } = await supabase.from("grievances").delete().eq("id", g.id);
    setBusyId(null);
    if (error) { notify(`Could not discard: ${error.message}`, "error"); return; }
    notify("Draft discarded");
    load();
  }

  if (loading) return <LoadingSpinner />;

  return (
    <div className="p-6">
      <PageHeader
        title="My Grievances"
        subtitle="Raise an issue with the school and follow it through to a resolution."
        icon={<MessageSquareWarning size={20} />}
      >
        <Button variant="gold" onClick={openNew}>
          <Plus size={14} /> Raise a grievance
        </Button>
      </PageHeader>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Total", value: counts.total },
          { label: "Open", value: counts.open },
          { label: "Resolved", value: counts.resolved },
          { label: "Rejected", value: counts.rejected },
        ].map((s) => (
          <Card key={s.label} className="p-4">
            <div className="text-xs text-gray-500">{s.label}</div>
            <div className="text-2xl font-bold text-[#0F2A47]">{s.value}</div>
          </Card>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<MessageSquareWarning size={28} />}
          message="No grievances yet. If something isn't right — a grade, transport, facilities — raise it here and the school will respond."
          action={{ label: "Raise a grievance", onClick: openNew }}
        />
      ) : (
        <div className="space-y-3">
          {rows.map((g) => {
            const meta = GRIEVANCE_STATUS_META[g.status];
            const isDraft = g.status === "draft";
            return (
              <Card key={g.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-gray-500">
                        {g.reference ?? "—"}
                      </span>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                    </div>
                    <div className="font-semibold text-[#0F2A47] mt-1">{g.subject}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {GRIEVANCE_CATEGORY_LABELS[g.category]}
                      {g.subcategory ? ` / ${g.subcategory}` : ""} · {fmtDateTime(g.created_at)}
                    </div>
                    {g.description && (
                      <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">{g.description}</p>
                    )}
                    {g.resolution && (
                      <div className="mt-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-900">
                        <div className="font-semibold text-xs uppercase tracking-wide mb-1">
                          School response
                        </div>
                        <p className="whitespace-pre-wrap">{g.resolution}</p>
                      </div>
                    )}
                  </div>

                  {isDraft && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(g)}>
                        <Pencil size={12} /> Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="gold"
                        disabled={busyId === g.id}
                        onClick={() => submitExisting(g)}
                      >
                        <Send size={12} /> {busyId === g.id ? "Submitting…" : "Submit"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId === g.id}
                        onClick={() => discard(g)}
                      >
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {showForm && (
        <Modal
          open
          onClose={() => setShowForm(false)}
          title={editing ? "Edit draft grievance" : "Raise a grievance"}
        >
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Subject</label>
              <input
                value={form.subject}
                onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
                placeholder="Short summary of the issue"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Category</label>
                <select
                  value={form.category}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      category: e.target.value as GrievanceCategory,
                      subcategory: "",
                    }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                >
                  <option value="academic">Academic</option>
                  <option value="non_academic">Non-Academic</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Type</label>
                <select
                  value={form.subcategory}
                  onChange={(e) => setForm((f) => ({ ...f, subcategory: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                >
                  <option value="">Not specified</option>
                  {GRIEVANCE_SUBCATEGORIES[form.category].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>

            {children.length > 0 && (
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Which child is this about?
                </label>
                <select
                  value={form.student_id}
                  onChange={(e) => setForm((f) => ({ ...f, student_id: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                >
                  <option value="">Not specific to one child</option>
                  {children.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Details</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={5}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
                placeholder="What happened, when, and who was involved?"
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" disabled={saving} onClick={() => save(false)}>
                Save draft
              </Button>
              <Button variant="gold" disabled={saving} onClick={() => save(true)}>
                <Send size={14} /> {saving ? "Saving…" : "Submit"}
              </Button>
            </div>
            <p className="text-xs text-gray-500">
              Once submitted you won&apos;t be able to edit it — the school takes it from there.
            </p>
          </div>
        </Modal>
      )}
      <ToastHost />
    </div>
  );
}
