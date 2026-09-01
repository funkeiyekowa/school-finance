"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { extractErrorMessage } from "@/lib/errors/extractErrorMessage";
import { useAuth } from "@/lib/context/AuthContext";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { AlertCircle, CheckCircle2, Trash2, Database } from "lucide-react";

interface SeedDataStats {
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
  focusOrgId: string | null;
}

// Supabase/Postgrest errors are plain objects ({ message, details, hint, code }),
// NOT instances of the JS Error class — `err instanceof Error` is false for them,
// which was silently swallowing the real database error and showing a generic
// fallback string instead. This pulls the message out of any error shape.
export function SeedDataPanel({ focusOrgId }: SeedDataPanelProps) {
  const supabase = createClient();
  const { profile } = useAuth();
  const [stats, setStats] = useState<SeedDataStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteMode, setDeleteMode] = useState<"test_only" | "all">("test_only");

  // Load stats on mount or when focusOrgId changes
  useEffect(() => {
    if (!focusOrgId) return;
    loadStats();
  }, [focusOrgId]);

  async function loadStats() {
    if (!focusOrgId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.rpc(
        "get_dummy_data_stats",
        { p_org: focusOrgId }
      );
      if (err) throw err;
      setStats(data as SeedDataStats);
    } catch (err) {
      setError(extractErrorMessage(err, "Failed to load stats"));
      setStats(null);
    } finally {
      setLoading(false);
    }
  }

  async function seedData() {
    if (!focusOrgId) return;
    setSeeding(true);
    setError(null);
    setSuccess(null);
    try {
      const { error: err } = await supabase.rpc("seed_dummy_data", {
        p_org: focusOrgId,
      });
      if (err) throw err;
      setSuccess("Test data seeded successfully!");
      // Refresh stats
      await loadStats();
    } catch (err) {
      setError(extractErrorMessage(err, "Failed to seed data"));
    } finally {
      setSeeding(false);
    }
  }

  async function deleteData() {
    if (!focusOrgId) return;
    setSeeding(true);
    setError(null);
    setSuccess(null);
    try {
      const { error: err } = await supabase.rpc("delete_dummy_data", {
        p_org: focusOrgId,
        p_delete_all: deleteMode === "all",
      });
      if (err) throw err;
      setSuccess(
        deleteMode === "test_only"
          ? "Test data deleted."
          : "All data deleted."
      );
      setShowDeleteModal(false);
      // Refresh stats
      await loadStats();
    } catch (err) {
      setError(extractErrorMessage(err, "Failed to delete data"));
    } finally {
      setSeeding(false);
    }
  }

  if (!focusOrgId) {
    return (
      <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg text-center">
        <p className="text-sm text-gray-500">Select a school to manage test data</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex items-start gap-3 mb-4">
          <Database size={18} className="text-[#0F2A47] shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-gray-900">Test Data Generator</h3>
            <p className="text-xs text-gray-500 mt-1">
              Populate realistic dummy data for testing and development
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
            <AlertCircle size={14} className="text-red-600 shrink-0 mt-0.5" />
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        {success && (
          <div className="mb-4 flex items-start gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
            <CheckCircle2 size={14} className="text-green-600 shrink-0 mt-0.5" />
            <p className="text-xs text-green-700">{success}</p>
          </div>
        )}

        {/* Stats Grid */}
        {stats && !loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <StatBox
              label="Students"
              total={stats.total_students}
              test={stats.test_students}
            />
            <StatBox
              label="Staff"
              total={stats.total_staff}
              test={stats.test_staff}
            />
            <StatBox
              label="Income (₦)"
              total={stats.total_income}
              test={stats.test_income}
              format="currency"
            />
            <StatBox
              label="Expenses (₦)"
              total={stats.total_expenses}
              test={stats.test_expenses}
              format="currency"
            />
          </div>
        ) : null}

        {/* Actions */}
        <div className="flex gap-2 flex-wrap">
          <Button
            size="sm"
            variant="gold"
            onClick={seedData}
            loading={seeding}
            disabled={loading}
          >
            Seed Test Data
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => setShowDeleteModal(true)}
            disabled={loading || seeding || !stats || (stats.total_students === 0 && stats.total_staff === 0)}
          >
            <Trash2 size={12} /> Delete Data
          </Button>
        </div>
      </div>

      {/* Delete Modal */}
      {showDeleteModal && (
        <Modal
          open
          onClose={() => setShowDeleteModal(false)}
          title="Delete Data"
          size="sm"
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Choose what to delete:
            </p>
            <div className="space-y-2">
              <label className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  checked={deleteMode === "test_only"}
                  onChange={() => setDeleteMode("test_only")}
                  className="w-4 h-4"
                />
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    Delete test data only
                  </div>
                  <div className="text-xs text-gray-500">
                    Keep your real data intact
                  </div>
                </div>
              </label>
              <label className="flex items-center gap-3 p-3 border border-red-200 rounded-lg cursor-pointer bg-red-50 hover:bg-red-100">
                <input
                  type="radio"
                  checked={deleteMode === "all"}
                  onChange={() => setDeleteMode("all")}
                  className="w-4 h-4"
                />
                <div>
                  <div className="text-sm font-medium text-red-900">
                    Delete all data
                  </div>
                  <div className="text-xs text-red-700">
                    ⚠️ This cannot be undone
                  </div>
                </div>
              </label>
            </div>
            <div className="flex justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => setShowDeleteModal(false)}
                disabled={seeding}
              >
                Cancel
              </Button>
              <Button
                variant={deleteMode === "all" ? "danger" : "secondary"}
                onClick={deleteData}
                loading={seeding}
              >
                Delete
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function StatBox({
  label,
  total,
  test,
  format = "number",
}: {
  label: string;
  total: number;
  test: number;
  format?: "number" | "currency";
}) {
  const formatted = (val: number) => {
    if (format === "currency") {
      return val.toLocaleString("en-NG", {
        style: "currency",
        currency: "NGN",
        maximumFractionDigits: 0,
      });
    }
    return val.toLocaleString();
  };

  return (
    <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-lg font-bold text-gray-900">
        {formatted(total)}
      </div>
      {test > 0 && (
        <div className="text-xs text-blue-600 mt-1">
          {test} test
        </div>
      )}
    </div>
  );
}
