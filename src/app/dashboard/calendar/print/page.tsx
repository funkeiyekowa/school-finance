"use client";

/**
 * Printable school calendar — the upcoming events across the
 * whole school, on the school letterhead, grouped by month.
 */

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useBranding } from "@/lib/hooks/useBranding";
import { LoadingSpinner } from "@/components/ui/PageHeader";
import { PrintableLetterhead, PrintableFooter } from "@/components/print/PrintableLetterhead";
import { Printer } from "lucide-react";

interface Event {
  id: string; title: string; description: string | null;
  location: string | null; starts_at: string; category: string | null;
  all_day: boolean; status: string;
}

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export default function CalendarPrintPage() {
  const supabase = useMemo(() => createClient(), []);
  const { orgId } = useAuth();
  const branding = useBranding();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) return;
    (async () => {
      const { data } = await supabase.from("website_events")
        .select("id, title, description, location, starts_at, category, all_day, status")
        .eq("organization_id", orgId)
        .neq("status", "cancelled")
        .gte("starts_at", new Date().toISOString().slice(0, 10))
        .order("starts_at");
      setEvents((data as Event[]) ?? []);
      setLoading(false);
    })();
  }, [supabase, orgId]);

  if (loading || !branding) return <div className="p-8"><LoadingSpinner /></div>;

  const grouped: { key: string; label: string; events: Event[] }[] = [];
  for (const e of events) {
    const d = new Date(e.starts_at);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const label = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    const g = grouped.find(x => x.key === key);
    if (g) g.events.push(e); else grouped.push({ key, label, events: [e] });
  }

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <div className="no-print sticky top-0 z-10 text-white px-6 py-3 flex items-center justify-between shadow-md" style={{ background: branding.primaryColor }}>
        <div>
          <p className="text-xs uppercase tracking-wider font-bold" style={{ color: branding.accentColor }}>School Calendar · {branding.schoolName}</p>
          <p className="text-sm font-medium">{events.length} upcoming event{events.length === 1 ? "" : "s"}</p>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold hover:opacity-90"
          style={{ background: branding.accentColor, color: branding.primaryColor }}
        >
          <Printer size={14} /> Print / Save as PDF
        </button>
      </div>

      <div className="max-w-3xl mx-auto py-6 print:py-0 print:max-w-full">
        <div className="bg-white shadow-sm rounded-lg p-8 print:shadow-none print:rounded-none">
          <PrintableLetterhead
            branding={branding}
            eyebrow="Upcoming School Events"
            accent="navy"
            right={
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-bold">Prepared</p>
                <p className="text-sm font-bold" style={{ color: branding.primaryColor }}>{new Date().toLocaleDateString("en-GB")}</p>
              </div>
            }
          />

          {events.length === 0 ? (
            <p className="py-6 text-center text-gray-400 italic">No upcoming events on file.</p>
          ) : grouped.map(g => (
            <section key={g.key} className="mb-4">
              <h3 className="text-xs uppercase font-bold tracking-widest mb-2" style={{ color: branding.accentColor }}>{g.label}</h3>
              <div className="space-y-1">
                {g.events.map(e => {
                  const d = new Date(e.starts_at);
                  return (
                    <div key={e.id} className="flex items-start gap-3 p-2 border-b border-gray-100 text-sm">
                      <div className="text-center w-12 shrink-0">
                        <p className="text-[9px] text-gray-500 uppercase font-bold">{MONTHS[d.getMonth()].slice(0, 3)}</p>
                        <p className="text-lg font-bold leading-none" style={{ color: branding.primaryColor }}>{d.getDate()}</p>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold" style={{ color: branding.primaryColor }}>{e.title}</p>
                        <p className="text-[11px] text-gray-500">
                          {e.all_day ? "All day" : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                          {e.location ? ` · ${e.location}` : ""}
                          {e.category ? ` · ${e.category}` : ""}
                        </p>
                        {e.description && <p className="text-xs text-gray-600 mt-0.5">{e.description}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}

          <PrintableFooter branding={branding} />
        </div>
      </div>

      <style>{`@media print { @page { size: A4; margin: 15mm; } }`}</style>
    </div>
  );
}
