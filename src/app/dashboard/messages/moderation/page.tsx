"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { PageHeader, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/lib/hooks/useToast";
import type { ModerationReport } from "@/lib/messaging/types";
import { ShieldAlert, MessageSquareWarning } from "lucide-react";

const STATUS_TABS = [
  { key: "open", label: "Open" },
  { key: "reviewing", label: "Reviewing" },
  { key: "actioned", label: "Actioned" },
  { key: "dismissed", label: "Dismissed" },
];

export default function ModerationPage() {
  const supabase = createClient();
  const router = useRouter();
  const { isOrgAdmin, hasModule } = useAuth();
  const { notify, ToastHost } = useToast();
  const [status, setStatus] = useState("open");
  const [reports, setReports] = useState<ModerationReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_moderation_reports", { p_status: status });
    if (!error) setReports((data as ModerationReport[]) ?? []);
    setLoading(false);
  }, [supabase, status]);

  useEffect(() => { load(); }, [load]);

  async function act(reportId: string, action: string, notes?: string) {
    setBusyId(reportId);
    const { error } = await supabase.rpc("moderate_message", { p_report_id: reportId, p_action: action, p_notes: notes ?? null });
    setBusyId(null);
    if (error) { notify(error.message, "error"); return; }
    notify("Report updated");
    load();
  }

  if (!hasModule("communication")) return <div className="p-6 text-gray-500">Communication is not enabled for your school.</div>;
  if (!isOrgAdmin) return <div className="p-6 text-gray-500">Only school administrators can moderate messaging.</div>;

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Message moderation" subtitle="Reports from students, parents and staff about messages or conversations." icon={<ShieldAlert size={22} />} />
      <Tabs tabs={STATUS_TABS} value={status} onChange={setStatus} />
      {loading ? <LoadingSpinner /> : reports.length === 0 ? (
        <EmptyState icon={<MessageSquareWarning size={32} />} message="No reports here — nothing in this queue right now." />
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <Card key={r.id}>
              <CardContent className="space-y-2">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{r.reason}</p>
                    <p className="text-xs text-gray-400">
                      Reported by {r.reporter_name} in &ldquo;{r.conversation_title}&rdquo; · {new Date(r.created_at).toLocaleString()}
                    </p>
                  </div>
                  <button onClick={() => router.push(`/dashboard/messages/${r.conversation_id}`)} className="text-xs text-[#0F2A47] font-medium hover:underline whitespace-nowrap">
                    View conversation
                  </button>
                </div>
                {r.message_body && <p className="text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">{r.message_body}</p>}
                {r.details && <p className="text-xs text-gray-500 italic">&ldquo;{r.details}&rdquo;</p>}
                {r.status === "open" || r.status === "reviewing" ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {r.message_id && (
                      <Button size="sm" variant="danger" loading={busyId === r.id} onClick={() => act(r.id, "remove_message")}>Remove message</Button>
                    )}
                    <Button size="sm" variant="secondary" loading={busyId === r.id} onClick={() => act(r.id, "lock_conversation", "Locked following a report")}>Lock conversation</Button>
                    <Button size="sm" variant="secondary" loading={busyId === r.id} onClick={() => act(r.id, "restrict_user", "Restricted following a moderation report")}>Restrict sender</Button>
                    <Button size="sm" variant="ghost" loading={busyId === r.id} onClick={() => act(r.id, "dismiss")}>Dismiss</Button>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">
                    {r.status === "actioned" ? "Actioned" : "Dismissed"}{r.resolution_notes ? ` — ${r.resolution_notes}` : ""}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <ToastHost />
    </div>
  );
}
