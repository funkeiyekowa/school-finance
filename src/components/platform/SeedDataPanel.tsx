"use client";

import { useState, useCallback, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Card } from "@/components/ui/Card";
import { AlertTriangle, Database, Trash2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface DummyDataStats {
  total_students: number;
  test_students: number;
  total_staff: number;
  test_staff: number;
  total_income: number;
  test_income: number;
  total_expenses: number;
  test_expenses: number;
}

interface SeedDataPanelProps {
  orgId: string;
}

export function SeedDataPanel({ orgId }: SeedDataPanelProps) {
  const supabase = createClient();
  const [stats, setStats] = useState<DummyDataStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteMode, setDeleteMode] = useState<"dummy" | "all">("dummy");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Load stats
  const loadStats = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.rpc("get_dummy_data_stats", { p_org: orgId });
      if (error) throw error;
      setStats(data as DummyDataStats);
    } catch (err) {
      console.error("Failed to load stats:", err);
    } finally {
      setLoading(false);
    }
  }, [supabase, orgId]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const handleSeedData = async () => {
    try {
      setSeeding(true);
      setMessage(null);
      const { data, error } = await supabase.rpc("seed_dummy_data", { p_org: orgId });
      if (error) throw error;
      if (data?.ok) {
        setMessage({
          type: "success",
          text: `✓ Created ${data.students_created} students, ${data.staff_created} staff, and ${data.income_records + data.expense_records} financial records`,
        });
        await loadStats();
      } else {
        setMessage({ type: "error", text: data?.error || "Failed to seed data" });
      }
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to seed data",
      });
    } finally {
      setSeeding(false);
    }
  };

  const handleDeleteData = async () => {
    try {
      setDeleting(true);
      setMessage(null);
      const { data, error } = await supabase.rpc("delete_dummy_data", {
        p_org: orgId,
        p_delete_all: deleteMode === "all",
      });
      if (error) throw error;
      if (data?.ok) {
        setMessage({
          type: "success",
          text: `✓ Deleted ${data.students_deleted} students, ${data.staff_deleted} staff, and ${data.income_deleted + data.expenses_deleted} financial records`,
        });
        await loadStats();
        setShowDeleteModal(false);
      } else {
        setMessage({ type: "error", text: data?.error || "Failed to delete data" });
      }
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to delete data",
      });
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <div className="text-gray-500 text-sm">Loading stats...</div>;

  return (
    <div className="space-y-4">
      <Card>
        <div className="p-4 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Database size={18} className="text-blue-600" />
                Test Data Generator
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                Populate realistic dummy data for testing and development
              </p>
            </div>
          </div>

          {message && (
            <div
              className={cn(
                "rounded-lg border p-3 text-sm",
                message.type === "success"
                  ? "border-green-200 bg-green-50 text-green-700"
                  : "border-red-200 bg-red-50 text-red-700"
              )}
            >
              {message.text}
            </div>
          )}

          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="rounded-lg bg-blue-50 p-3">
                <div className="text-xs text-gray-600">Students</div>
                <div className="text-lg font-bold text-blue-700">{stats.total_students}</div>
                {stats.test_students > 0 && (
                  <div className="text-[10px] text-blue-600 mt-1">{stats.test_students} test</div>
                )}
              </div>
              <div className="rounded-lg bg-green-50 p-3">
                <div className="text-xs text-gray-600">Staff</div>
                <div className="text-lg font-bold text-green-700">{stats.total_staff}</div>
                {stats.test_staff > 0 && (
                  <div className="text-[10px] text-green-600 mt-1">{stats.test_staff} test</div>
                )}
              </div>
              <div className="rounded-lg bg-purple-50 p-3">
                <div className="text-xs text-gray-600">Income</div>
                <div className="text-lg font-bold text-purple-700">
                  {(stats.total_income / 1000).toFixed(0)}k
                </div>
                {stats.test_income > 0 && (
                  <div className="text-[10px] text-purple-600 mt-1">
                    {(stats.test_income / 1000).toFixed(0)}k test
                  </div>
                )}
              </div>
              <div className="rounded-lg bg-orange-50 p-3">
                <div className="text-xs text-gray-600">Expenses</div>
                <div className="text-lg font-bold text-orange-700">
                  {(stats.total_expenses / 1000).toFixed(0)}k
                </div>
                {stats.test_expenses > 0 && (
                  <div className="text-[10px] text-orange-600 mt-1">
                    {(stats.test_expenses / 1000).toFixed(0)}k test
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button
              variant="gold"
              size="sm"
              onClick={handleSeedData}
              loading={seeding}
              disabled={seeding || deleting}
              className="gap-2"
            >
              <Plus size={14} />
              Seed Test Data
            </Button>
            {stats && (stats.test_students > 0 || stats.test_staff > 0) && (
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  setDeleteMode("dummy");
                  setShowDeleteModal(true);
                }}
                disabled={seeding || deleting}
                className="gap-2"
              >
                <Trash2 size={14} />
                Delete Data
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <Modal
          open
          onClose={() => setShowDeleteModal(false)}
          title="Delete Data"
          size="sm"
        >
          <div className="space-y-4">
            <div className="flex gap-3 bg-red-50 border border-red-200 rounded-lg p-3">
              <AlertTriangle size={20} className="text-red-600 shrink-0 mt-0.5" />
              <div className="text-sm text-red-700">
                This action cannot be undone. Choose what to delete:
              </div>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="deleteMode"
                  value="dummy"
                  checked={deleteMode === "dummy"}
                  onChange={e => setDeleteMode(e.target.value as "dummy" | "all")}
                />
                <div>
                  <div className="font-medium text-sm">Delete Test Data Only</div>
                  <div className="text-xs text-gray-500">
                    Remove only records marked as test data ({stats?.test_students || 0} students,{" "}
                    {stats?.test_staff || 0} staff)
                  </div>
                </div>
              </label>
              <label className="flex items-center gap-3 p-3 border border-red-200 rounded-lg cursor-pointer hover:bg-red-50">
                <input
                  type="radio"
                  name="deleteMode"
                  value="all"
                  checked={deleteMode === "all"}
                  onChange={e => setDeleteMode(e.target.value as "dummy" | "all")}
                />
                <div>
                  <div className="font-medium text-sm text-red-700">Delete All Data</div>
                  <div className="text-xs text-gray-500">
                    Remove ALL students, staff, and financial records ({stats?.total_students || 0}{" "}
                    students, {stats?.total_staff || 0} staff)
                  </div>
                </div>
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowDeleteModal(false)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleDeleteData}
                loading={deleting}
              >
                Delete {deleteMode === "dummy" ? "Test Data" : "All Data"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
