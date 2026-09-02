"use client";

/**
 * Printable announcement / letter to parents.
 *
 * Renders a single announcement as a formal note on the school
 * letterhead, ready to send home in a folder. Uses the school's
 * branding and shows the priority (urgent → red accent bar).
 */

import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useBranding } from "@/lib/hooks/useBranding";
import { fmtDate } from "@/lib/utils";
import { LoadingSpinner } from "@/components/ui/PageHeader";
import { PrintableLetterhead, PrintableFooter } from "@/components/print/PrintableLetterhead";
import { Printer } from "lucide-react";

interface Ann {
  id: string; title: string; body: string;
  target: string; priority: string;
  published: boolean; published_at: string | null;
  created_at: string;
}

export default function AnnouncementPrintPage() {
  const params = useParams<{ id: string }>();
  const supabase = useMemo(() => createClient(), []);
  const { profile } = useAuth();
  const branding = useBranding();
  const [ann, setAnn] = useState<Ann | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("announcements").select("*").eq("id", params.id).maybeSingle();
      setAnn((data as Ann) ?? null);
      setLoading(false);
    })();
  }, [supabase, params.id]);

  if (loading || !branding) return <div className="p-8"><LoadingSpinner /></div>;
  if (!ann) return <div className="p-8 text-center text-gray-500">Announcement not found.</div>;

  const accent = ann.priority === "urgent" ? "rose" : ann.priority === "high" ? "amber" : "navy";
  const targetLabel = ann.target === "parents" ? "Dear Parents & Guardians"
    : ann.target === "students" ? "Dear Students"
    : ann.target === "staff" ? "To all Staff"
    : "Dear School Community";

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <div className="no-print sticky top-0 z-10 text-white px-6 py-3 flex items-center justify-between shadow-md" style={{ background: branding.primaryColor }}>
        <div>
          <p className="text-xs uppercase tracking-wider font-bold" style={{ color: branding.accentColor }}>Announcement · {branding.schoolName}</p>
          <p className="text-sm font-medium truncate max-w-md">{ann.title}</p>
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
        <div className="bg-white shadow-sm rounded-lg p-10 print:shadow-none print:rounded-none">
          <PrintableLetterhead
            branding={branding}
            eyebrow={ann.priority === "urgent" ? "Urgent Notice" : "Notice to Parents"}
            accent={accent}
            right={
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-bold">Ref</p>
                <p className="text-sm font-bold" style={{ color: branding.primaryColor }}>NOT/{ann.id.slice(0, 8).toUpperCase()}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{fmtDate((ann.published_at || ann.created_at).slice(0, 10))}</p>
              </div>
            }
          />

          {ann.priority === "urgent" && (
            <div className="mb-4 rounded-lg p-3 border" style={{ background: "#FEE2E2", borderColor: "#DC2626" }}>
              <p className="text-xs font-bold uppercase tracking-widest text-red-700">Urgent — please read immediately</p>
            </div>
          )}

          <p className="text-sm font-semibold mb-3">{targetLabel},</p>

          <h1 className="text-xl font-bold mb-4" style={{ color: branding.primaryColor }}>
            {ann.title}
          </h1>

          <div className="text-sm leading-relaxed whitespace-pre-wrap mb-8">
            {ann.body}
          </div>

          <div className="mt-10">
            <p>Yours faithfully,</p>
            <div className="mt-8">
              <p style={{ borderTop: `1px solid ${branding.primaryColor}`, width: "220px" }}></p>
              <p className="font-semibold text-sm mt-1" style={{ color: branding.primaryColor }}>
                {profile?.full_name ?? "The Principal"}
              </p>
              <p className="text-xs text-gray-500">{branding.schoolName}</p>
            </div>
          </div>

          <PrintableFooter branding={branding} />
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4; margin: 20mm; }
        }
      `}</style>
    </div>
  );
}
