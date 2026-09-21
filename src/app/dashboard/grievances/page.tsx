"use client";

/**
 * /dashboard/grievances
 *
 * Staff triage queue. Everything raised in this organisation lands here —
 * RLS scopes the read to the caller's org and to staff roles, so this page
 * never sees another school's grievances and a student never reaches it.
 *
 * Drafts are deliberately excluded: a draft belongs to the person writing
 * it and hasn't been sent to the school yet.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtDateTime, cn } from "@/lib/utils";
import { PageHeader, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/lib/hooks/useToast";
import { MessageSquareWarning, Search, CheckCircle, XCircle, PlayCircle } from "lucide-react";
import {
  type Grievance,
  type GrievanceStatus,
  GRIEVANCE_STATUS_META,
  GRIEVANCE_CATEGORY_LABELS,
  GRIEVANCE_PRIORITY_LABELS,
} from "@/lib/types/grievances";

const TABS: { key: string; label: string; match: (g: Grievance) => boolean }[] = [
  { key: "open", label: "Open", match: (g) => g.status === "submitted" || g.status === "in_progress" },
  { key: "submitted", label: "New", match: (g) => g.status === "submitted" },
  { key: "in_progress", label: "In progress", match: (g) => g.status === "in_progress" },
  { key: "resolved", label: "Resolved", match: (g) => g.status === "resolved" },
  { key: "rejected", label: "Rejected", match: (g) => g.status === "rejected" },
  { key: "all", label: "All", match: () => true },
];

export default function GrievancesPage() {
  const { profile, canEdit, orgId } = useAuth();
  const supabase = createClient();
  const { notify, ToastHost } = useToast();

  const [rows, setRows] = useState<Grievance[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("open");
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<Grievance | null>(null);
  const [resolution, setResolution] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    let gq = supabase
      .from("grievances")
      .select("*")
      .neq("status", "draft")
      .order("created_at", { ascending: false });
    if (orgId) gq = gq.eq("organization_id", orgId);
    const { data, error } = await gq;
    if (error) notify(`Could not load grievances: ${error.message}`, "error");
    const list = (data ?? []) as Grievance[];
    setRows(list);

    const ids = Array.from(new Set(list.map((g) => g.student_id).filter(Boolean))) as string[];
    if (ids.length) {
      let sq = supabase
        .from("students")
        .select("id, full_name, first_name, last_name")
        .in("id", ids);
      if (orgId) sq = sq.eq("organization_id", orgId);
      const { data: studs, error: studErr } = await sq;
      if (studErr) notify(`Could not load student names: ${studErr.message}`, "error");
      const map: Record<string, string> = {};
      for (const s of (studs ?? []) as {
        id: string; full_name: string | null;
        first_name: string | null; last_name: string | null;
      }[]) {
        map[s.id] =
          s.full_name?.trim() ||
          [s.first_name, s.last_name].filter(Boolean).join(" ").trim() ||
          "Student";
      }
      setNames(map);
    }
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
    return rows.filter(t.match).filter((g) => {
      if (!q) return true;
      return (
        (g.reference ?? "").toLowerCase().includes(q) ||
        g.subject.toLowerCase().includes(q) ||
        (g.subcategory ?? "").toLowerCase().includes(q) ||
        (g.student_id ? (names[g.student_id] ?? "").toLowerCase().includes(q) : false)
      );
    });
  }, [rows, tab, search, names]);

  async function setStatus(g: Grievance, status: GrievanceStatus, withResolution?: string) {
    setSaving(true);
    const patch: Record<string, unknown> = { status };
    if (withResolution !== undefined) patch.resolution = withResolution.trim() || null;
    const { error } = await supabase.from("grievances").update(patch).eq("id", g.id);
    setSaving(false);
    if (error) { notify(`Update failed: ${error.message}`, "error"); return; }

    await supabase.from("activity_log").insert({
      user_email: profile?.email,
      user_name: profile?.full_name,
      action: "Update Grievance",
      details: `${g.reference ?? g.id} → ${status}`,
      organization_id: g.organization_id,
    });

    notify(`${g.reference ?? "Grievance"} marked ${GRIEVANCE_STATUS_META[status].label.toLowerCase()}`);
    setActive(null);
    setResolution("");
    load();
  }

  if (loading) return <LoadingSpinner />;

  return (
    <div className="p-6">
      <PageHeader
        title="Grievances"
        subtitle="Issues raised by students and parents, and how they were resolved."
        icon={<MessageSquareWarning size={20} />}
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
              tab === t.key
                ? "bg-[#0F2A47] text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            )}
          >
            {t.label}
            <span className="ml-1.5 opacity-70">{tabCounts[t.key] ?? 0}</span>
          </button>
        ))}
        <div className="relative ml-auto">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search reference, subject, student…"
            className="rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm w-72 focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<MessageSquareWarning size={28} />}
          message={
            tab === "open"
              ? "No open grievances. Anything students or parents submit will appear here."
              : "No grievances match this filter."
          }
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((g) => {
            const meta = GRIEVANCE_STATUS_META[g.status];
            return (
              <Card key={g.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-gray-500">{g.reference ?? "—"}</span>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                      {g.priority !== "normal" && (
                        <Badge variant={g.priority === "high" ? "red" : "gray"}>
                          {GRIEVANCE_PRIORITY_LABELS[g.priority]} priority
                        </Badge>
                      )}
                    </div>
                    <div className="font-semibold text-[#0F2A47] mt-1">{g.subject}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {GRIEVANCE_CATEGORY_LABELS[g.category]}
                      {g.subcategory ? ` / ${g.subcategory}` : ""}
                      {g.student_id && names[g.student_id] ? ` · ${names[g.student_id]}` : ""}
                      {" · "}
                      {fmtDateTime(g.submitted_at ?? g.created_at)}
                    </div>
                    {g.description && (
                      <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">{g.description}</p>
                    )}
                    {g.resolution && (
                      <div className="mt-3 p-3 rounded-lg bg-gray-50 border border-gray-200 text-sm text-gray-700">
                        <div className="font-semibold text-xs uppercase tracking-wide mb-1 text-gray-500">
                          Response
                        </div>
                        <p className="whitespace-pre-wrap">{g.resolution}</p>
                      </div>
                    )}
                  </div>

                  {canEdit && (
                    <div className="flex items-center gap-1 shrink-0">
                      {g.status === "submitted" && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={saving}
                          onClick={() => setStatus(g, "in_progress")}
                        >
                          <PlayCircle size={12} /> Pick up
                        </Button>
                      )}
                      {(g.status === "submitted" || g.status === "in_progress") && (
                        <>
                          <Button
                            size="sm"
                            variant="gold"
                            onClick={() => { setActive(g); setResolution(g.resolution ?? ""); }}
                          >
                            <CheckCircle size={12} /> Resolve
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={saving}
                            onClick={() => setStatus(g, "rejected")}
                          >
                            <XCircle size={12} /> Reject
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {active && (
        <Modal open onClose={() => setActive(null)} title={`Resolve ${active.reference ?? "grievance"}`}>
          <div className="space-y-3">
            <div className="text-sm text-gray-600">{active.subject}</div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Response to the raiser
              </label>
              <textarea
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                rows={5}
                autoFocus
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
                placeholder="What was done about it?"
              />
              <p className="text-xs text-gray-500 mt-1">
                This is shown to the student or parent who raised it.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setActive(null)}>Cancel</Button>
              <Button
                variant="gold"
                disabled={saving}
                onClick={() => setStatus(active, "resolved", resolution)}
              >
                {saving ? "Saving…" : "Mark resolved"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
      <ToastHost />
    </div>
  );
}
