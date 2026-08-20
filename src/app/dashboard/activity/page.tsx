"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtDateTime } from "@/lib/utils";
import { PageHeader, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { exportCSV } from "@/lib/utils";
import { RefreshCw, Activity, Download } from "lucide-react";
import type { ActivityLog } from "@/lib/types";

export default function ActivityPage() {
  const { isAdmin } = useAuth();
  const supabase = createClient();
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(100);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("activity_log")
      .select("*")
      .order("timestamp", { ascending: false })
      .limit(limit);
    setLogs(data ?? []);
    setLoading(false);
  }, [supabase, limit]);

  useEffect(() => { load(); }, [load]);

  if (!isAdmin) return <div className="p-6 text-gray-500">Admin access required.</div>;

  function handleExport() {
    exportCSV(logs.map(l => ({
      Timestamp: fmtDateTime(l.timestamp), User: l.user_name || l.user_email || "", Action: l.action, Details: l.details || "",
    })), "activity-log");
  }

  const actionColors: Record<string, string> = {
    "Record Income": "bg-green-100 text-green-700",
    "Record Expense": "bg-red-100 text-red-700",
    "Add Student": "bg-blue-100 text-blue-700",
    "Add Vendor": "bg-purple-100 text-purple-700",
    "Reconcile": "bg-amber-100 text-amber-700",
    "Update User": "bg-gray-100 text-gray-700",
    "Create Role": "bg-[#F4E9C7] text-[#0F2A47]",
    "Update Role Permissions": "bg-[#F4E9C7] text-[#0F2A47]",
    "Update School Settings": "bg-blue-50 text-blue-700",
    "Add Fee Schedule": "bg-green-50 text-green-700",
    "Add Bank Line": "bg-amber-50 text-amber-700",
  };

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Activity Log" subtitle="Audit trail of all actions performed in the app">
        <Button variant="secondary" size="sm" onClick={handleExport}>
          <Download size={14} /> Export
        </Button>
        <Button variant="secondary" size="sm" onClick={() => load()}>
          <RefreshCw size={14} /> Refresh
        </Button>
      </PageHeader>

      {loading ? <LoadingSpinner /> : (
        <>
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#0F2A47] text-white">
                    <th className="text-left px-4 py-3 text-xs font-semibold">Timestamp</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold">User</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold">Action</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.length === 0 ? (
                    <tr><td colSpan={4}><EmptyState message="No activity logged yet." icon={<Activity size={32} />} /></td></tr>
                  ) : (
                    logs.map(log => (
                      <tr key={log.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{fmtDateTime(log.timestamp)}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-xs">{log.user_name || "—"}</div>
                          <div className="text-gray-400 text-xs">{log.user_email}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${actionColors[log.action] || "bg-gray-100 text-gray-600"}`}>
                            {log.action}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-xs max-w-[300px] truncate">{log.details || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {logs.length === limit && (
            <div className="text-center">
              <Button variant="secondary" onClick={() => setLimit(l => l + 100)}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
