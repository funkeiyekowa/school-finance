"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useToast } from "@/lib/hooks/useToast";
import { extractErrorMessage } from "@/lib/errors/extractErrorMessage";
import { fmtMoney } from "@/lib/utils";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Lock } from "lucide-react";

interface StaffSalary {
  id: string;
  staff_code: string;
  full_name: string;
  job_title: string | null;
  salary: number | null;
}

export default function SalaryManagementPage() {
  const supabase = useMemo(() => createClient(), []);
  const { canEdit, isAdmin, membership } = useAuth();
  const { notify, ToastHost } = useToast();

  const [loading, setLoading] = useState(true);
  const [staff, setStaff] = useState<StaffSalary[]>([]);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSalary, setEditSalary] = useState("");
  const [saving, setSaving] = useState(false);
  const [isBursary, setIsBursary] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Check if current user is bursary staff
      const { data: staffData, error: staffError } = await supabase
        .from("staff_members")
        .select("role")
        .maybeSingle();
      
      const hasRole = staffData?.role === "bursary" || staffData?.role === "admin";
      setIsBursary(hasRole && (canEdit || isAdmin));

      if (!hasRole) {
        setLoading(false);
        return;
      }

      // Load staff salaries
      const { data, error } = await supabase
        .from("staff_members")
        .select("id, staff_code, full_name, job_title, salary")
        .eq("status", "active")
        .order("full_name");
      
      if (error) throw error;
      setStaff((data as StaffSalary[]) ?? []);
    } catch (err) {
      notify(extractErrorMessage(err, "Failed to load staff."), "error");
    } finally {
      setLoading(false);
    }
  }, [supabase, canEdit, isAdmin, notify]);

  useEffect(() => { load(); }, [load]);

  const filtered = staff.filter(s =>
    search === "" ||
    s.full_name.toLowerCase().includes(search.toLowerCase()) ||
    s.staff_code.toLowerCase().includes(search.toLowerCase())
  );

  async function saveSalary(staffId: string) {
    const salary = editSalary.trim() === "" ? null : Number(editSalary);
    if (salary !== null && (isNaN(salary) || salary < 0)) {
      notify("Salary must be a valid positive number.", "error");
      return;
    }
    
    setSaving(true);
    try {
      const { error } = await supabase
        .from("staff_members")
        .update({ salary })
        .eq("id", staffId);
      
      if (error) throw error;
      notify(`Salary updated to ${salary === null ? "empty" : fmtMoney(salary)}.`);
      setEditingId(null);
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Failed to save salary."), "error");
    } finally {
      setSaving(false);
    }
  }

  if (!isBursary) {
    return (
      <div className="min-h-screen bg-slate-50 p-8 flex items-center justify-center">
        <Card className="max-w-md">
          <div className="flex items-start gap-3 text-red-600 mb-4">
            <Lock className="w-5 h-5 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">Access Denied</p>
              <p className="text-sm text-gray-600 mt-1">
                Salary Management is restricted to Bursary staff only.
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <PageHeader
        title="Salary Management"
        subtitle="Confidential: Bursary only. Set monthly basic salaries for payroll deductions."
      />
      <ToastHost />

      {loading ? (
        <LoadingSpinner />
      ) : staff.length === 0 ? (
        <Card className="p-8 text-center text-gray-500">
          No active staff members found.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="p-4 border-b border-gray-200">
            <input
              type="text"
              placeholder="Search by name or staff code..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-100 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-2 text-left text-sm font-semibold">Code</th>
                  <th className="px-4 py-2 text-left text-sm font-semibold">Name</th>
                  <th className="px-4 py-2 text-left text-sm font-semibold">Title</th>
                  <th className="px-4 py-2 text-right text-sm font-semibold">Monthly Salary (₦)</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => (
                  <tr key={s.id} className="border-b border-gray-100 hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm font-mono text-gray-600">{s.staff_code}</td>
                    <td className="px-4 py-3 text-sm">{s.full_name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{s.job_title || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      {editingId === s.id ? (
                        <div className="flex gap-2 justify-end">
                          <input
                            type="number"
                            min="0"
                            step="1000"
                            value={editSalary}
                            onChange={e => setEditSalary(e.target.value)}
                            placeholder="0"
                            className="w-32 px-2 py-1 border border-gray-300 rounded text-sm"
                            autoFocus
                          />
                          <Button
                            size="sm"
                            onClick={() => saveSalary(s.id)}
                            disabled={saving}
                          >
                            {saving ? "Saving..." : "Save"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingId(null)}
                            disabled={saving}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <div className="flex gap-2 justify-end items-center">
                          <span className="font-semibold">
                            {s.salary ? fmtMoney(s.salary) : "—"}
                          </span>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setEditingId(s.id);
                              setEditSalary(s.salary ? String(s.salary) : "");
                            }}
                          >
                            Edit
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filtered.length === 0 && (
            <div className="p-8 text-center text-gray-500">
              No staff members match your search.
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
