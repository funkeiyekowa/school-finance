"use client";

/**
 * Printable class timetable.
 *
 * ?class=<class_id> selects which class's timetable to print.
 * A single sheet with the school letterhead, class name, and the
 * standard periods × days grid — ready to laminate and hand out.
 *
 * Display/print presentation (which fields show, paper size,
 * orientation, density, fonts, colours, title/footer text) is
 * read from timetable_settings via get_my_timetable_settings() --
 * see supabase/20260906190000_timetable_setup_settings.sql and
 * /dashboard/setup/timetable. This only affects how the page
 * *looks*; it has no bearing on which class's data may be
 * fetched -- that is still enforced by the role-scoped
 * authorization below plus RLS on timetable_entries (see
 * supabase/fix_timetable_role_scoped_access.sql), both unchanged.
 */

import { Suspense, useEffect, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useBranding } from "@/lib/hooks/useBranding";
import { cn } from "@/lib/utils";
import { LoadingSpinner } from "@/components/ui/PageHeader";
import { PrintableLetterhead, PrintableFooter } from "@/components/print/PrintableLetterhead";
import { Printer } from "lucide-react";

interface ClassRow { id: string; name: string; }
interface SubjectRow { id: string; name: string; short_code: string; }
interface PeriodRow { id: string; name: string; short_code: string; start_time: string; end_time: string; is_break: boolean; sort_order: number; }
interface EntryRow { id: string; class_id: string; subject_id: string; period_id: string; teacher_name: string | null; day_of_week: number; room: string | null; }

interface TimetableSettings {
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
  document_title: string | null;
  footer_text: string | null;
  paper_size: "A4" | "A3" | "Letter" | "Legal";
  orientation: "portrait" | "landscape";
  layout_density: "compact" | "comfortable" | "spacious";
  font_size_pt: number;
  cell_padding_px: number;
  show_borders: boolean;
  primary_color: string | null;
  accent_color: string | null;
  break_row_color: string | null;
}

// Same shape as timetable_settings' column defaults (see the
// migration) -- applied when an org admin hasn't configured
// anything yet, so the print page looks exactly as it always has.
const DEFAULT_SETTINGS: TimetableSettings = {
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
  document_title: null,
  footer_text: null,
  paper_size: "A4",
  orientation: "landscape",
  layout_density: "comfortable",
  font_size_pt: 10,
  cell_padding_px: 6,
  show_borders: true,
  primary_color: null,
  accent_color: null,
  break_row_color: null,
};

const DAYS = [
  { num: 1, short: "Mon", label: "Monday" },
  { num: 2, short: "Tue", label: "Tuesday" },
  { num: 3, short: "Wed", label: "Wednesday" },
  { num: 4, short: "Thu", label: "Thursday" },
  { num: 5, short: "Fri", label: "Friday" },
];

const PAGE_SIZE_MM: Record<TimetableSettings["paper_size"], string> = {
  A4: "A4",
  A3: "A3",
  Letter: "letter",
  Legal: "legal",
};

const DENSITY_ROW_SCALE: Record<TimetableSettings["layout_density"], number> = {
  compact: 0.6,
  comfortable: 1,
  spacious: 1.5,
};

export default function TimetablePrintPage() {
  return (
    <Suspense fallback={<div className="p-8"><LoadingSpinner /></div>}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const params = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const { orgId, membership, isAdmin, isSuperAdmin, isDeveloper } = useAuth();
  const branding = useBranding();
  const requestedClassId = params.get("class") ?? "";

  const [cls, setCls] = useState<ClassRow | null>(null);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [periods, setPeriods] = useState<PeriodRow[]>([]);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [session, setSession] = useState<{ current_term: string | null; current_year: string | null } | null>(null);
  const [settings, setSettings] = useState<TimetableSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  // Defense in depth: RLS on timetable_entries (see
  // supabase/fix_timetable_role_scoped_access.sql) is the actual
  // enforcement -- a student or teacher passing another class's id here
  // gets zero timetable rows back regardless. This additionally refuses to
  // even attempt the fetch for a non-privileged caller whose own
  // authorized class doesn't match the requested one, so the URL can't be
  // used to fish for other classes' names/existence via this page either.
  const role = membership?.role ?? "";
  const isTeacherRole = role === "teacher";
  const isPrivilegedStaff =
    isAdmin || isSuperAdmin || isDeveloper ||
    ["editor", "staff", "bursar", "accountant", "developer", "super_admin", "viewer"].includes(role);

  useEffect(() => {
    if (!orgId || !requestedClassId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      let effectiveClassId = requestedClassId;

      if (!isPrivilegedStaff) {
        if (isTeacherRole) {
          const { data } = await supabase
            .from("teacher_assignments")
            .select("class_id")
            .eq("class_id", requestedClassId)
            .eq("active", true)
            .limit(1);
          if (!data || data.length === 0) { if (!cancelled) { setDenied(true); setLoading(false); } return; }
        } else {
          const { data: myClassId } = await supabase.rpc("get_my_current_class_id");
          if (!myClassId || myClassId !== requestedClassId) { if (!cancelled) { setDenied(true); setLoading(false); } return; }
          effectiveClassId = myClassId as string;
        }
      }

      const [cRes, subRes, perRes, entRes, settingsRes, schoolRes] = await Promise.all([
        supabase.from("classes").select("id, name").eq("id", effectiveClassId).maybeSingle(),
        supabase.from("subjects").select("id, name, short_code").eq("active", true),
        supabase.from("periods").select("*").eq("active", true).order("sort_order"),
        supabase.from("timetable_entries").select("*").eq("class_id", effectiveClassId),
        supabase.rpc("get_my_timetable_settings"),
        supabase.from("school_settings").select("current_term, current_year").maybeSingle(),
      ]);
      if (cancelled) return;
      setCls((cRes.data as ClassRow) ?? null);
      setSubjects((subRes.data as SubjectRow[]) ?? []);
      setPeriods((perRes.data as PeriodRow[]) ?? []);
      setEntries((entRes.data as EntryRow[]) ?? []);
      setSession((schoolRes.data as { current_term: string | null; current_year: string | null }) ?? null);
      if (!settingsRes.error && settingsRes.data) {
        const row = settingsRes.data as Partial<TimetableSettings>;
        setSettings({ ...DEFAULT_SETTINGS, ...row });
      } else {
        setSettings(DEFAULT_SETTINGS);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase, orgId, requestedClassId, isPrivilegedStaff, isTeacherRole]);

  if (loading || !branding) return <div className="p-8"><LoadingSpinner /></div>;
  if (denied) return <div className="p-8 text-center text-gray-500">You are not authorized to view this class&apos;s timetable.</div>;
  if (!cls) return <div className="p-8 text-center text-gray-500">Select a class first.</div>;

  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  function entryFor(periodId: string, day: number): EntryRow | undefined {
    return entries.find((e) => e.period_id === periodId && e.day_of_week === day);
  }

  const primaryColor = settings.primary_color || branding.primaryColor;
  const accentColor = settings.accent_color || branding.accentColor;
  const breakRowColor = settings.break_row_color || "#fffbeb";
  const documentTitle = settings.document_title?.trim() || "Class Timetable";
  const footerText = settings.footer_text?.trim();
  const rowScale = DENSITY_ROW_SCALE[settings.layout_density];
  const cellPad = settings.cell_padding_px;
  const cellStyle = { padding: `${rowScale * cellPad}px ${cellPad}px` };
  const sessionLabel = [
    settings.show_session && session?.current_year,
    settings.show_term && session?.current_term,
  ].filter(Boolean).join(" · ");

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <div className="no-print sticky top-0 z-10 text-white px-6 py-3 flex items-center justify-between shadow-md" style={{ background: primaryColor }}>
        <div>
          <p className="text-xs uppercase tracking-wider font-bold" style={{ color: accentColor }}>{documentTitle} · {branding.schoolName}</p>
          <p className="text-sm font-medium">{cls.name}</p>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold hover:opacity-90"
          style={{ background: accentColor, color: primaryColor }}
        >
          <Printer size={14} /> Print / Save as PDF
        </button>
      </div>

      <div className="max-w-5xl mx-auto py-6 print:py-0 print:max-w-full" style={{ fontSize: `${settings.font_size_pt}px` }}>
        <div className="bg-white shadow-sm rounded-lg p-8 print:shadow-none print:rounded-none">
          <PrintableLetterhead
            branding={{
              ...branding,
              logoUrl: settings.show_logo ? branding.logoUrl : null,
              schoolName: settings.show_school_name ? branding.schoolName : "",
            }}
            eyebrow={documentTitle}
            accent="navy"
            right={
              <div>
                {settings.show_class && (
                  <>
                    <p className="text-[10px] text-gray-500 uppercase font-bold">Class</p>
                    <p className="text-lg font-bold" style={{ color: primaryColor }}>{cls.name}</p>
                  </>
                )}
                {sessionLabel && <p className="text-[11px] text-gray-500 mt-0.5">{sessionLabel}</p>}
                <p className="text-[11px] text-gray-500 mt-0.5">Effective {new Date().toLocaleDateString("en-GB")}</p>
              </div>
            }
          />

          <table className="w-full border-collapse" style={{ fontSize: "1em" }}>
            <thead>
              <tr style={{ background: primaryColor, color: "#fff" }}>
                <th className={cn("text-left w-28", settings.show_borders && "border")} style={cellStyle}>Period</th>
                {DAYS.map((d) => (
                  <th key={d.num} className={cn("text-center", settings.show_borders && "border")} style={cellStyle}>{d.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p.id} style={{ background: p.is_break && settings.show_breaks ? breakRowColor : undefined }}>
                  <td className={cn("align-top", settings.show_borders && "border")} style={cellStyle}>
                    <p className="font-semibold" style={{ color: primaryColor }}>{p.short_code}</p>
                    {settings.show_period_times && (
                      <p className="text-[0.85em] text-gray-500">
                        {String(p.start_time).substring(0, 5)}–{String(p.end_time).substring(0, 5)}
                      </p>
                    )}
                    {p.is_break && settings.show_breaks && <p className="text-[0.85em] font-bold text-amber-600 mt-0.5">BREAK</p>}
                  </td>
                  {DAYS.map((d) => {
                    if (p.is_break) {
                      return settings.show_breaks ? (
                        <td key={d.num} className={cn("text-center italic text-amber-700", settings.show_borders && "border")} style={cellStyle}>Break</td>
                      ) : (
                        <td key={d.num} className={cn(settings.show_borders && "border")} style={cellStyle} />
                      );
                    }
                    const e = entryFor(p.id, d.num);
                    if (!e) return <td key={d.num} className={cn("align-top text-center text-gray-300", settings.show_borders && "border")} style={cellStyle}>—</td>;
                    const subj = subjectById.get(e.subject_id);
                    return (
                      <td key={d.num} className={cn("align-top", settings.show_borders && "border")} style={cellStyle}>
                        {settings.show_subject && <p className="text-[1em] font-semibold" style={{ color: primaryColor }}>{subj?.name ?? "?"}</p>}
                        {settings.show_teacher && e.teacher_name && <p className="text-[0.85em] text-gray-500">{e.teacher_name}</p>}
                        {settings.show_room && e.room && <p className="text-[0.85em] text-gray-400">Room {e.room}</p>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 flex items-center justify-between text-[0.85em] text-gray-500">
            <p>Total periods scheduled: {entries.length}</p>
            <p>Printed {new Date().toLocaleString("en-GB")}</p>
          </div>

          {footerText && <p className="mt-2 text-[0.85em] text-gray-500">{footerText}</p>}

          <PrintableFooter branding={branding} />
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: ${PAGE_SIZE_MM[settings.paper_size]} ${settings.orientation}; margin: 12mm; }
        }
      `}</style>
    </div>
  );
}
