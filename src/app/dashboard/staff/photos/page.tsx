"use client";

/**
 * Admin bulk photo upload for staff. Same match-preview flow as
 * students/photos, but the whole active staff list at once (typically
 * a much smaller set than a school's student body).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useToast } from "@/lib/hooks/useToast";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { BulkPhotoUploader, type RosterPerson } from "@/components/photos/BulkPhotoUploader";
import { Camera } from "lucide-react";

interface StaffRow {
  id: string;
  full_name: string;
  staff_code: string;
  photo_url: string | null;
}

export default function StaffPhotosPage() {
  const supabase = useMemo(() => createClient(), []);
  const { orgId, canEdit } = useAuth();
  const { notify, ToastHost } = useToast();

  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadStaff = useCallback(async () => {
    const { data } = await supabase
      .from("staff_members")
      .select("id, full_name, staff_code, photo_url")
      .eq("status", "active")
      .order("full_name");
    setStaff((data as StaffRow[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadStaff(); }, [loadStaff]);

  const roster: RosterPerson[] = staff.map((s) => ({
    id: s.id,
    name: s.full_name,
    subLabel: s.staff_code,
    currentPhotoUrl: s.photo_url,
  }));

  async function handleCommit(pairs: { id: string; photoUrl: string }[]) {
    const payload = pairs.map((p) => ({ staff_id: p.id, photo_url: p.photoUrl }));
    const { error } = await supabase.rpc("bulk_set_staff_photos", { p_pairs: payload });
    if (error) throw new Error(error.message);
    await loadStaff();
  }

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;

  if (!canEdit) {
    return (
      <div className="p-6">
        <Card className="p-8 text-center text-gray-500">
          You don&apos;t have permission to upload staff photos.
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        icon={<Camera size={24} />}
        gradient="navy"
        title="Staff Photos"
        subtitle="Bulk-upload staff photos for ID cards, matched against the list before saving"
      />
      <ToastHost />

      {staff.length === 0 ? (
        <Card className="p-8 text-center text-gray-500">No active staff found.</Card>
      ) : orgId ? (
        <BulkPhotoUploader
          orgId={orgId}
          kind="staff"
          roster={roster}
          onCommit={handleCommit}
          notify={notify}
        />
      ) : null}
    </div>
  );
}
