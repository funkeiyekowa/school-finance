"use client";

/**
 * Admin/staff moderation queue for parent-submitted student photos.
 *
 * Parents submit a photo (from My Children) but it never touches
 * students.photo_url until an admin approves it here -- keeps low-quality
 * or wrong submissions off official ID cards without manual review.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useToast } from "@/lib/hooks/useToast";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { FileCheck2, Check, X } from "lucide-react";

interface Submission {
  id: string;
  student_id: string;
  photo_url: string;
  status: string;
  created_at: string;
  students: { full_name: string; student_code: string; grade: string | null } | null;
}

export default function PhotoApprovalsPage() {
  const supabase = useMemo(() => createClient(), []);
  const { canEdit } = useAuth();
  const { notify, ToastHost } = useToast();

  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("student_photo_submissions")
      .select("id, student_id, photo_url, status, created_at, students(full_name, student_code, grade)")
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (error) notify(error.message, "error");
    setSubmissions((data as unknown as Submission[]) ?? []);
    setLoading(false);
  }, [supabase, notify]);

  useEffect(() => { load(); }, [load]);

  async function approve(id: string) {
    setBusyId(id);
    try {
      const { error } = await supabase.rpc("approve_student_photo", { p_submission_id: id });
      if (error) throw new Error(error.message);
      notify("Photo approved.");
      setSubmissions((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not approve.", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    const reason = window.prompt("Reason for rejecting this photo (optional):") ?? undefined;
    setBusyId(id);
    try {
      const { error } = await supabase.rpc("reject_student_photo", { p_submission_id: id, p_reason: reason || null });
      if (error) throw new Error(error.message);
      notify("Photo rejected.");
      setSubmissions((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not reject.", "error");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;

  if (!canEdit) {
    return (
      <div className="p-6">
        <Card className="p-8 text-center text-gray-500">You don&apos;t have permission to review photo submissions.</Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        icon={<FileCheck2 size={24} />}
        gradient="amber"
        title="Photo Approvals"
        subtitle="Parent-submitted student photos awaiting review before they appear on ID cards"
      />
      <ToastHost />

      {submissions.length === 0 ? (
        <Card className="p-8 text-center text-gray-500">No photos waiting for review.</Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {submissions.map((s) => (
            <Card key={s.id} className="overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.photo_url} alt="" className="w-full h-40 object-cover" />
              <div className="p-3 space-y-2">
                <div>
                  <p className="text-sm font-semibold truncate">{s.students?.full_name ?? "Unknown"}</p>
                  <p className="text-xs text-gray-500">{s.students?.student_code} · {s.students?.grade ?? "—"}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="gold" className="flex-1" disabled={busyId === s.id} onClick={() => approve(s.id)}>
                    <Check size={13} /> Approve
                  </Button>
                  <Button size="sm" variant="ghost" className="flex-1" disabled={busyId === s.id} onClick={() => reject(s.id)}>
                    <X size={13} /> Reject
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
