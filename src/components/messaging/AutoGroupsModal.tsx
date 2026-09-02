"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/Modal";
import { LoadingSpinner } from "@/components/ui/PageHeader";
import { Users, BookOpen, Building2 } from "lucide-react";
import { useToast } from "@/lib/hooks/useToast";

interface Props {
  open: boolean;
  onClose: () => void;
  onOpened: (conversationId: string) => void;
}

interface ClassRow { id: string; name: string; }
interface DeptRow { id: string; name: string; }

/**
 * Lets staff jump into the school's server-managed groups (Section 6) —
 * per-class teacher coordination, per-class parent groups, and
 * departments — creating/syncing them on demand via sync_auto_group()
 * rather than pre-generating every possible group up front.
 */
export function AutoGroupsModal({ open, onClose, onOpened }: Props) {
  const supabase = createClient();
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [departments, setDepartments] = useState<DeptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const { notify, ToastHost } = useToast();

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([
      supabase.from("classes").select("id, name").eq("active", true).order("sequence"),
      supabase.from("departments").select("id, name").eq("active", true).order("name"),
    ]).then(([c, d]) => {
      setClasses((c.data as ClassRow[]) ?? []);
      setDepartments((d.data as DeptRow[]) ?? []);
      setLoading(false);
    });
  }, [open, supabase]);

  async function open_(kind: string, key: string, params: Record<string, string>) {
    setBusyKey(key);
    const { data, error } = await supabase.rpc("sync_auto_group", { p_kind: kind, ...params });
    setBusyKey(null);
    if (error) { notify(error.message, "error"); return; }
    if (data) { onClose(); onOpened(data as string); }
  }

  return (
    <Modal open={open} onClose={onClose} title="School groups" size="md">
      <ToastHost />
      {loading ? <LoadingSpinner /> : (
        <div className="space-y-4 max-h-96 overflow-y-auto">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Users size={13} /> Class teacher groups
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {classes.map((c) => (
                <button key={c.id} disabled={busyKey === `cs-${c.id}`}
                  onClick={() => open_("class_staff", `cs-${c.id}`, { p_class_id: c.id })}
                  className="text-left px-3 py-2 rounded-lg border border-gray-200 hover:border-[#C9A227] hover:bg-[#FBF6E8] text-sm disabled:opacity-50">
                  {c.name}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <BookOpen size={13} /> Class parent groups
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {classes.map((c) => (
                <button key={c.id} disabled={busyKey === `pg-${c.id}`}
                  onClick={() => open_("parent_group", `pg-${c.id}`, { p_class_id: c.id })}
                  className="text-left px-3 py-2 rounded-lg border border-gray-200 hover:border-[#C9A227] hover:bg-[#FBF6E8] text-sm disabled:opacity-50">
                  {c.name} Parents
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Building2 size={13} /> Departments &amp; staff
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              <button disabled={busyKey === "staff"} onClick={() => open_("staff", "staff", {})}
                className="text-left px-3 py-2 rounded-lg border border-gray-200 hover:border-[#C9A227] hover:bg-[#FBF6E8] text-sm disabled:opacity-50">
                All staff
              </button>
              {departments.map((d) => (
                <button key={d.id} disabled={busyKey === `dp-${d.id}`}
                  onClick={() => open_("department", `dp-${d.id}`, { p_department_id: d.id })}
                  className="text-left px-3 py-2 rounded-lg border border-gray-200 hover:border-[#C9A227] hover:bg-[#FBF6E8] text-sm disabled:opacity-50">
                  {d.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
