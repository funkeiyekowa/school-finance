"use client";

/**
 * School calendar — upcoming events view.
 *
 * Uses website_events (with `publish_internally=true` or any
 * status) as a single source of school-wide dates. Grouped by
 * month, filter by category, one-click printable.
 */

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { PageHeader, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { CalendarClock, Printer, MapPin } from "lucide-react";

interface Event {
  id: string; slug: string; title: string; description: string | null;
  location: string | null; starts_at: string; ends_at: string | null;
  all_day: boolean; category: string | null; status: string;
}

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export default function SchoolCalendarPage() {
  const supabase = useMemo(() => createClient(), []);
  const { orgId } = useAuth();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState("");
  const [showPast, setShowPast] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    (async () => {
      const { data } = await supabase.from("website_events")
        .select("id, slug, title, description, location, starts_at, ends_at, all_day, category, status")
        .neq("status", "cancelled")
        .eq("organization_id", orgId)
        .order("starts_at");
      setEvents((data as Event[]) ?? []);
      setLoading(false);
    })();
  }, [supabase, orgId]);

  const filtered = events.filter(e => {
    if (filterCategory && e.category !== filterCategory) return false;
    if (!showPast && new Date(e.starts_at) < new Date(Date.now() - 24 * 3600 * 1000)) return false;
    return true;
  });

  const grouped: { key: string; label: string; events: Event[] }[] = [];
  for (const e of filtered) {
    const d = new Date(e.starts_at);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const label = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    const g = grouped.find(x => x.key === key);
    if (g) g.events.push(e); else grouped.push({ key, label, events: [e] });
  }

  const categories = Array.from(new Set(events.map(e => e.category).filter(Boolean))).sort() as string[];

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        icon={<CalendarClock size={24} />}
        gradient="navy"
        title="School Calendar"
        subtitle="Upcoming events, key dates, and term-highlights."
      >
        <Button
          variant="secondary"
          onClick={() => window.open("/dashboard/calendar/print", "_blank")}
          title="Printable version on your school's letterhead"
        >
          <Printer size={14} /> Print calendar
        </Button>
      </PageHeader>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
          <option value="">All categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
          <input type="checkbox" checked={showPast} onChange={e => setShowPast(e.target.checked)} />
          Include past events
        </label>
        <span className="ml-auto text-xs text-gray-500">{filtered.length} event{filtered.length === 1 ? "" : "s"}</span>
      </div>

      {grouped.length === 0 ? (
        <EmptyState message="No upcoming events. Add events under Website Studio → Events." icon={<CalendarClock size={36} />} />
      ) : (
        <div className="space-y-6">
          {grouped.map(g => (
            <div key={g.key}>
              <h2 className="text-xs uppercase font-bold tracking-widest text-[#C9A227] mb-2">{g.label}</h2>
              <div className="space-y-2">
                {g.events.map(e => {
                  const d = new Date(e.starts_at);
                  return (
                    <Card key={e.id} className="!p-4">
                      <div className="flex items-start gap-4">
                        <div className="text-center w-14 shrink-0">
                          <p className="text-[10px] text-gray-500 uppercase font-bold">{MONTHS[d.getMonth()].slice(0, 3)}</p>
                          <p className="text-2xl font-bold text-[#0F2A47] leading-none mt-0.5">{d.getDate()}</p>
                          {!e.all_day && (
                            <p className="text-[10px] text-gray-500 mt-1">{d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</p>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm font-semibold text-[#0F2A47]">{e.title}</h3>
                            {e.category && <span className="text-[10px] font-bold uppercase bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">{e.category}</span>}
                            {e.status !== "published" && <span className="text-[10px] font-bold uppercase bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{e.status}</span>}
                          </div>
                          {e.location && <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1"><MapPin size={11} /> {e.location}</p>}
                          {e.description && <p className="text-xs text-gray-600 mt-1 line-clamp-2">{e.description}</p>}
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
