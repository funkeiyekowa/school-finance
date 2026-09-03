"use client";

/**
 * Self-service photo upload for the signed-in staff member.
 *
 * Matches the caller to their own staff_members row by email (staff
 * have no dedicated auth-link column -- see update_my_staff_photo RPC),
 * so this only ever writes the caller's own row, never anyone else's.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useToast } from "@/lib/hooks/useToast";
import { uploadProfilePhoto } from "@/lib/photos/storage";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Camera, Upload } from "lucide-react";

interface MyStaffRow {
  id: string;
  full_name: string;
  staff_code: string;
  job_title: string | null;
  photo_url: string | null;
}

export default function MyProfilePage() {
  const supabase = useMemo(() => createClient(), []);
  const { user, orgId, profile } = useAuth();
  const { notify, ToastHost } = useToast();

  const [staffRow, setStaffRow] = useState<MyStaffRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    if (!user?.email) { setLoading(false); return; }
    const { data } = await supabase
      .from("staff_members")
      .select("id, full_name, staff_code, job_title, photo_url")
      .ilike("email", user.email)
      .maybeSingle();
    setStaffRow((data as MyStaffRow) ?? null);
    setLoading(false);
  }, [supabase, user]);

  useEffect(() => { load(); }, [load]);

  async function handleFile(file: File) {
    if (!orgId || !staffRow) return;
    setUploading(true);
    try {
      const photoUrl = await uploadProfilePhoto(orgId, "staff", staffRow.id, file);
      const { error } = await supabase.rpc("update_my_staff_photo", { p_photo_url: photoUrl });
      if (error) throw new Error(error.message);
      setStaffRow((prev) => (prev ? { ...prev, photo_url: photoUrl } : prev));
      notify("Photo updated.");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not update photo.", "error");
    } finally {
      setUploading(false);
    }
  }

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;

  return (
    <div className="p-6 space-y-5 max-w-lg">
      <PageHeader icon={<Camera size={24} />} gradient="navy" title="My Profile" subtitle="Update the photo shown on your staff ID card" />
      <ToastHost />

      {!staffRow ? (
        <Card className="p-8 text-center text-gray-500">
          No staff record was found matching your login email
          ({user?.email ?? "unknown"}). Ask an administrator to check your
          Staff Directory entry.
        </Card>
      ) : (
        <Card className="p-6 flex flex-col items-center gap-4">
          {staffRow.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={staffRow.photo_url}
              alt={staffRow.full_name}
              className="h-32 w-32 rounded-full object-cover border-4 border-[#C9A227]"
            />
          ) : (
            <div className="h-32 w-32 rounded-full flex items-center justify-center text-3xl font-bold text-white bg-gradient-to-br from-[#0F2A47] to-[#C9A227]">
              {staffRow.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
            </div>
          )}

          <div className="text-center">
            <p className="font-bold text-[#0F2A47]">{staffRow.full_name}</p>
            <p className="text-xs text-gray-500">{staffRow.job_title || "—"} · {staffRow.staff_code}</p>
          </div>

          <label>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
            <span className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-[#0F2A47] text-white hover:bg-[#1B3E63] cursor-pointer">
              {uploading ? "Uploading…" : (
                <><Upload size={14} /> {staffRow.photo_url ? "Change photo" : "Upload photo"}</>
              )}
            </span>
          </label>
          <p className="text-[11px] text-gray-400 text-center">
            Use a clear, front-facing photo — this appears on your staff ID card
            and payslip.
          </p>
        </Card>
      )}
    </div>
  );
}
