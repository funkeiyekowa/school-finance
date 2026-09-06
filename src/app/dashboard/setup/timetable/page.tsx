"use client";

/**
 * /dashboard/setup/timetable
 *
 * Lets a school admin configure how the timetable displays and
 * prints: which fields show (teacher, subject, class, period times,
 * breaks, room, logo, school name, session, term), title/footer
 * text, paper size/orientation, layout density, font size, cell
 * padding, borders, and colours. A live preview panel mirrors the
 * actual print page's rendering so changes are visible before
 * saving.
 *
 * This page only touches presentation. It never reads or writes
 * classes/subjects/periods/timetable_entries, and it has no effect
 * on who may see which class's timetable -- that access control is
 * enforced independently by RLS on timetable_entries (see
 * supabase/fix_timetable_role_scoped_access.sql) and is unrelated to
 * this settings table.
 *
 * Backed by supabase/20260906190000_timetable_setup_settings.sql:
 *   - timetable_settings (one row per organisation)
 *   - get_my_timetable_settings() (read convenience RPC)
 * RLS: any org member can read (the print page needs it for every
 * role), only org admins (is_org_admin) can write -- this page is
 * additionally gated by the /dashboard/setup route group's
 * server-side admin-only guard (setup/layout.tsx).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useBranding } from "@/lib/hooks/useBranding";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { cn } from "@/lib/utils";
import { ArrowLeft, CalendarClock, Save } from "lucide-react";

interface TimetableSettingsForm {
  show_teacher: boolean;
  show_subject: boolean;
  show_class: boolean;
  show_period_times: boolean;
  show_breaks: boolean;
  show_room: boolean;
  show_logo: boolean;
  show_school_name: boolean;
  show_session: boolean;
  show_term: boolean;
  document_title: string;
  footer_text: string;
  paper_size: "A4" | "A3" | "Letter" | "Legal";
  orientation: "portrait" | "landscape";
  layout_density: "compact" | "comfortable" | "spacious";
  font_size_pt: number;
  cell_padding_px: number;
  show_borders: boolean;
  primary_color: string;
  accent_color: string;
  break_row_color: string;
}

const DEFAULTS: TimetableSettingsForm = {
  show_teacher: true,
  show_subject: true,
  show_class: true,
  show_period_times: true,
  show_breaks: true,
  show_room: true,
  show_logo: true,
  show_school_name: true,
  show_session: true,
  show_term: true,
  document_title: "",
  footer_text: "",
  paper_size: "A4",
  orientation: "landscape",
  layout_density: "comfortable",
  font_size_pt: 10,
  cell_padding_px: 6,
  show_borders: true,
  primary_color: "",
  accent_color: "",
  break_row_color: "",
};

const DENSITY_ROW_PADDING: Record<TimetableSettingsForm["layout_density"], number> = {
  compact: 0.6,
  comfortable: 1,
  spacious: 1.5,
};

// Sample data purely for the on-page preview -- never written anywhere,
// never touches real classes/subjects/periods/timetable_entries.
const PREVIEW_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const PREVIEW_PERIODS = [
  { code: "P1", time: "08:00–08:45", isBreak: false },
  { code: "P2", time: "08:45–09:30", isBreak: false },
  { code: "BRK", time: "09:30–09:45", isBreak: true },
  { code: "P3", time: "09:45–10:30", isBreak: false },
];
const PREVIEW_ENTRY = { subject: "Mathematics", teacher: "Mrs. Adeyemi", room: "12" };

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1.5 cursor-pointer">
      <span className="text-sm text-gray-700">{label}</span>
      <span className="relative inline-flex items-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only peer"
        />
        <span className="w-11 h-6 bg-gray-300 peer-focus:ring-2 peer-focus:ring-[#C9A227] rounded-full peer peer-checked:bg-[#0F2A47] transition-colors" />
        <span
          className={cn(
            "absolute top-0.5 left-[2px] bg-white rounded-full h-5 w-5 transition-transform",
            checked && "translate-x-full"
          )}
        />
      </span>
    </label>
  );
}

export default function TimetableSetupPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { orgId, isOrgAdmin } = useAuth();
  const branding = useBranding();

  const [loading, setLoading] = useState(true);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [form, setForm] = useState<TimetableSettingsForm>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const { data, error: loadErr } = await supabase.rpc("get_my_timetable_settings");
    if (!loadErr && data) {
      const row = data as Record<string, unknown>;
      setSettingsId((row.id as string) ?? null);
      setForm({
        show_teacher: (row.show_teacher as boolean) ?? DEFAULTS.show_teacher,
        show_subject: (row.show_subject as boolean) ?? DEFAULTS.show_subject,
        show_class: (row.show_class as boolean) ?? DEFAULTS.show_class,
        show_period_times: (row.show_period_times as boolean) ?? DEFAULTS.show_period_times,
        show_breaks: (row.show_breaks as boolean) ?? DEFAULTS.show_breaks,
        show_room: (row.show_room as boolean) ?? DEFAULTS.show_room,
        show_logo: (row.show_logo as boolean) ?? DEFAULTS.show_logo,
        show_school_name: (row.show_school_name as boolean) ?? DEFAULTS.show_school_name,
        show_session: (row.show_session as boolean) ?? DEFAULTS.show_session,
        show_term: (row.show_term as boolean) ?? DEFAULTS.show_term,
        document_title: (row.document_title as string) ?? "",
        footer_text: (row.footer_text as string) ?? "",
        paper_size: (row.paper_size as TimetableSettingsForm["paper_size"]) ?? DEFAULTS.paper_size,
        orientation: (row.orientation as TimetableSettingsForm["orientation"]) ?? DEFAULTS.orientation,
        layout_density: (row.layout_density as TimetableSettingsForm["layout_density"]) ?? DEFAULTS.layout_density,
        font_size_pt: (row.font_size_pt as number) ?? DEFAULTS.font_size_pt,
        cell_padding_px: (row.cell_padding_px as number) ?? DEFAULTS.cell_padding_px,
        show_borders: (row.show_borders as boolean) ?? DEFAULTS.show_borders,
        primary_color: (row.primary_color as string) ?? "",
        accent_color: (row.accent_color as string) ?? "",
        break_row_color: (row.break_row_color as string) ?? "",
      });
    } else {
      setSettingsId(null);
      setForm(DEFAULTS);
    }
    setLoading(false);
  }, [supabase, orgId]);

  useEffect(() => { load(); }, [load]);

  if (!isOrgAdmin) {
    return <div className="p-6 text-gray-500">Only school administrators can manage timetable setup.</div>;
  }
  if (loading || !branding) return <div className="p-6"><LoadingSpinner /></div>;

  function set<K extends keyof TimetableSettingsForm>(key: K, value: TimetableSettingsForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    if (!orgId) return;
    setSaving(true);
    setError(null);
    const payload = { organization_id: orgId, ...form };
    const { error: saveErr } = settingsId
      ? await supabase.from("timetable_settings").update(form).eq("id", settingsId)
      : await supabase.from("timetable_settings").insert(payload);
    if (saveErr) {
      setError(saveErr.message);
      setSaving(false);
      return;
    }
    setSaving(false);
    setNotice("Timetable setup saved.");
    setTimeout(() => setNotice(null), 2500);
    await load();
  }

  const previewPrimary = form.primary_color || branding.primaryColor;
  const previewAccent = form.accent_color || branding.accentColor;
  const previewBreakBg = form.break_row_color || "#fffbeb";
  const rowPad = DENSITY_ROW_PADDING[form.layout_density];
  const previewTitle = form.document_title.trim() || "Class Timetable";
  const previewFooter = form.footer_text.trim();

  return (
    <div className="p-6 space-y-5">
      <button
        onClick={() => router.push("/dashboard/setup")}
        className="text-xs text-gray-500 hover:text-[#0F2A47] flex items-center gap-1"
      >
        <ArrowLeft size={12} /> Back to Setup
      </button>

      <PageHeader
        title="Timetable Setup"
        subtitle="Configure how the timetable displays and prints for your school. This does not change class schedules, subject allocations, or who can view which class's timetable."
        icon={<CalendarClock size={22} />}
      />

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {notice && <div role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">{notice}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {/* Settings form */}
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle>Fields to show</CardTitle></CardHeader>
            <CardContent className="divide-y divide-gray-100">
              <Toggle label="Teacher name" checked={form.show_teacher} onChange={(v) => set("show_teacher", v)} />
              <Toggle label="Subject" checked={form.show_subject} onChange={(v) => set("show_subject", v)} />
              <Toggle label="Class name" checked={form.show_class} onChange={(v) => set("show_class", v)} />
              <Toggle label="Period start/end times" checked={form.show_period_times} onChange={(v) => set("show_period_times", v)} />
              <Toggle label="Break periods" checked={form.show_breaks} onChange={(v) => set("show_breaks", v)} />
              <Toggle label="Room" checked={form.show_room} onChange={(v) => set("show_room", v)} />
              <Toggle label="School logo" checked={form.show_logo} onChange={(v) => set("show_logo", v)} />
              <Toggle label="School name" checked={form.show_school_name} onChange={(v) => set("show_school_name", v)} />
              <Toggle label="Session" checked={form.show_session} onChange={(v) => set("show_session", v)} />
              <Toggle label="Term" checked={form.show_term} onChange={(v) => set("show_term", v)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Title & footer</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Input
                label="Document title"
                placeholder="Class Timetable"
                value={form.document_title}
                onChange={(e) => set("document_title", e.target.value)}
                helpText="Leave blank to use the default, &quot;Class Timetable&quot;."
              />
              <Input
                label="Footer text"
                placeholder="e.g. Approved by the Academic Office"
                value={form.footer_text}
                onChange={(e) => set("footer_text", e.target.value)}
                helpText="Optional line shown at the bottom of the printed sheet, below the school contact details."
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Paper & layout</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Select
                  label="Paper size"
                  value={form.paper_size}
                  onChange={(e) => set("paper_size", e.target.value as TimetableSettingsForm["paper_size"])}
                  options={[
                    { value: "A4", label: "A4" },
                    { value: "A3", label: "A3" },
                    { value: "Letter", label: "Letter" },
                    { value: "Legal", label: "Legal" },
                  ]}
                />
                <Select
                  label="Orientation"
                  value={form.orientation}
                  onChange={(e) => set("orientation", e.target.value as TimetableSettingsForm["orientation"])}
                  options={[
                    { value: "landscape", label: "Landscape" },
                    { value: "portrait", label: "Portrait" },
                  ]}
                />
              </div>
              <Select
                label="Layout density"
                value={form.layout_density}
                onChange={(e) => set("layout_density", e.target.value as TimetableSettingsForm["layout_density"])}
                options={[
                  { value: "compact", label: "Compact" },
                  { value: "comfortable", label: "Comfortable" },
                  { value: "spacious", label: "Spacious" },
                ]}
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Font size ({form.font_size_pt}pt)</label>
                  <input
                    type="range" min={7} max={16} value={form.font_size_pt}
                    onChange={(e) => set("font_size_pt", Number(e.target.value))}
                    className="w-full accent-[#0F2A47]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Cell padding ({form.cell_padding_px}px)</label>
                  <input
                    type="range" min={0} max={24} value={form.cell_padding_px}
                    onChange={(e) => set("cell_padding_px", Number(e.target.value))}
                    className="w-full accent-[#0F2A47]"
                  />
                </div>
              </div>
              <Toggle label="Show cell borders" checked={form.show_borders} onChange={(v) => set("show_borders", v)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Colours</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-gray-500">Leave any colour blank to use your school&apos;s default brand colours.</p>
              <div className="grid grid-cols-3 gap-3">
                <ColorField label="Header / primary" value={form.primary_color} fallback={branding.primaryColor} onChange={(v) => set("primary_color", v)} />
                <ColorField label="Accent" value={form.accent_color} fallback={branding.accentColor} onChange={(v) => set("accent_color", v)} />
                <ColorField label="Break row" value={form.break_row_color} fallback="#fffbeb" onChange={(v) => set("break_row_color", v)} />
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={save} loading={saving}>
              <Save size={14} /> Save timetable setup
            </Button>
          </div>
        </div>

        {/* Live preview */}
        <div className="lg:sticky lg:top-6">
          <Card>
            <CardHeader><CardTitle>Preview</CardTitle></CardHeader>
            <CardContent>
              <p className="text-xs text-gray-500 mb-3">
                Sample data only, for layout preview — this never reads or affects real class timetables.
              </p>
              <div className="border border-gray-200 rounded-lg overflow-auto bg-white p-4" style={{ fontSize: `${form.font_size_pt}px` }}>
                <div className="mb-3 pb-2 flex items-start justify-between gap-3" style={{ borderBottom: `3px solid ${previewAccent}` }}>
                  <div className="flex items-center gap-2 min-w-0">
                    {form.show_logo && (
                      branding.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={branding.logoUrl} alt="" className="h-9 w-9 rounded object-contain shrink-0" />
                      ) : (
                        <div
                          className="h-9 w-9 rounded flex items-center justify-center text-white font-bold text-xs shrink-0"
                          style={{ background: `linear-gradient(135deg, ${previewPrimary}, ${previewAccent})` }}
                        >
                          {(branding.schoolName.match(/\b\w/g) ?? ["S"]).slice(0, 2).join("")}
                        </div>
                      )
                    )}
                    <div className="min-w-0">
                      <p className="text-[9px] uppercase font-bold tracking-widest" style={{ color: previewAccent }}>{previewTitle}</p>
                      {form.show_school_name && (
                        <p className="text-sm font-bold truncate" style={{ color: previewPrimary }}>{branding.schoolName}</p>
                      )}
                      {(form.show_session || form.show_term) && (
                        <p className="text-[10px] text-gray-500">
                          {[form.show_session && "2026/2027", form.show_term && "Term 1"].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                  </div>
                  {form.show_class && (
                    <div className="text-right shrink-0">
                      <p className="text-[9px] text-gray-500 uppercase font-bold">Class</p>
                      <p className="text-sm font-bold" style={{ color: previewPrimary }}>SSS1</p>
                    </div>
                  )}
                </div>

                <table className="w-full border-collapse" style={{ fontSize: "0.9em" }}>
                  <thead>
                    <tr style={{ background: previewPrimary, color: "#fff" }}>
                      <th className={cn("text-left px-2", form.show_borders && "border")} style={{ paddingTop: rowPad * form.cell_padding_px, paddingBottom: rowPad * form.cell_padding_px }}>Period</th>
                      {PREVIEW_DAYS.slice(0, 3).map((d) => (
                        <th key={d} className={cn("text-center px-2", form.show_borders && "border")} style={{ paddingTop: rowPad * form.cell_padding_px, paddingBottom: rowPad * form.cell_padding_px }}>{d}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {PREVIEW_PERIODS.map((p) => (
                      <tr key={p.code} style={{ background: p.isBreak && form.show_breaks ? previewBreakBg : undefined }}>
                        <td className={cn("align-top px-2", form.show_borders && "border")} style={{ padding: form.cell_padding_px }}>
                          <p className="font-semibold" style={{ color: previewPrimary }}>{p.code}</p>
                          {form.show_period_times && <p className="text-[0.75em] text-gray-500">{p.time}</p>}
                        </td>
                        {PREVIEW_DAYS.slice(0, 3).map((d, i) => {
                          if (p.isBreak) {
                            return form.show_breaks ? (
                              <td key={d} className={cn("text-center italic", form.show_borders && "border")} style={{ padding: form.cell_padding_px, color: "#b45309" }}>Break</td>
                            ) : (
                              <td key={d} className={cn(form.show_borders && "border")} style={{ padding: form.cell_padding_px }} />
                            );
                          }
                          if (i !== 0) return <td key={d} className={cn("text-center text-gray-300", form.show_borders && "border")} style={{ padding: form.cell_padding_px }}>—</td>;
                          return (
                            <td key={d} className={cn("align-top", form.show_borders && "border")} style={{ padding: form.cell_padding_px }}>
                              {form.show_subject && <p className="font-semibold" style={{ color: previewPrimary }}>{PREVIEW_ENTRY.subject}</p>}
                              {form.show_teacher && <p className="text-[0.75em] text-gray-500">{PREVIEW_ENTRY.teacher}</p>}
                              {form.show_room && <p className="text-[0.75em] text-gray-400">Room {PREVIEW_ENTRY.room}</p>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>

                {previewFooter && (
                  <p className="mt-3 pt-2 border-t border-gray-100 text-[0.75em] text-gray-500">{previewFooter}</p>
                )}
              </div>
              <p className="text-[11px] text-gray-400 mt-2">
                Paper: {form.paper_size} · {form.orientation === "landscape" ? "Landscape" : "Portrait"}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ColorField({ label, value, fallback, onChange }: { label: string; value: string; fallback: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={value || fallback}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-9 rounded border border-gray-300 cursor-pointer shrink-0"
        />
        <input
          type="text"
          value={value}
          placeholder={fallback}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
        />
      </div>
    </div>
  );
}
