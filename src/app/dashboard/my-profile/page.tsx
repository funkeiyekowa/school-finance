"use client";

/**
 * Self-service photo for the signed-in user, whoever they are.
 *
 * Previously this page only ever looked up a staff_members row, so
 * every parent or student landed on "No staff record found" regardless
 * of their login. Now backed by get_my_profile() (see
 * supabase/messaging_and_profile_fixes.sql), which resolves the
 * caller's own record across staff, students and parents -- mirroring
 * the same role-lookup pattern already used by the messaging RPCs.
 *
 * Upload path differs by role:
 *   - staff: update_my_staff_photo -- writes staff_members.photo_url
 *     directly (trusted self-service, unchanged from before).
 *   - student: submit_student_photo_self -- queued for admin/staff
 *     approval, same safeguard as a parent submitting a child's photo,
 *     so a low-quality or wrong photo never lands on an ID card
 *     unreviewed.
 *   - parent: this schema has no single "parent photo" (a parent's
 *     photo flow is per-child, on My Children), so parents get a
 *     friendly explanation instead of a broken staff lookup.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useToast } from "@/lib/hooks/useToast";
import { uploadProfilePhoto } from "@/lib/photos/storage";
import { SelfieCapture } from "@/components/photos/SelfieCapture";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Camera, Upload, Clock } from "lucide-react";

interface MyProfileRow {
  kind: "staff" | "student" | "parent" | "unknown";
  entity_id: string | null;
  full_name: string;
  subtitle: string | null;
  photo_url: string | null;
}

export default function MyProfilePage() {
  const supabase = useMemo(() => createClient(), []);
  const { orgId } = useAuth();
  const { notify, ToastHost } = useToast();

  const [me, setMe] = useState<MyProfileRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [pendingReview, setPendingReview] = useState(false);
  const [selfieOpen, setSelfieOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc("get_my_profile");
    const row = Array.isArray(data) ? data[0] : data;
    setMe((row as MyProfileRow) ?? null);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  async function handleFile(file: File) {
    if (!orgId || !me?.entity_id) return;
    setUploading(true);
    try {
      if (me.kind === "staff") {
        const photoUrl = await uploadProfilePhoto(orgId, "staff", me.entity_id, file);
        const { error } = await supabase.rpc("update_my_staff_photo", { p_photo_url: photoUrl });
        if (error) throw new Error(error.message);
        setMe((prev) => (prev ? { ...prev, photo_url: photoUrl } : prev));
        notify("Photo updated.");
      } else if (me.kind === "student") {
        const photoUrl = await uploadProfilePhoto(orgId, "students", me.entity_id, file);
        const { error } = await supabase.rpc("submit_student_photo_self", { p_photo_url: photoUrl });
        if (error) throw new Error(error.message);
        setPendingReview(true);
        notify("Photo submitted — a school administrator will review it shortly.");
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not update photo.", "error");
    } finally {
      setUploading(false);
    }
  }

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;

  return (
    <div className="p-6 space-y-5 max-w-lg">
      <PageHeader icon={<Camera size={24} />} gradient="navy" title="My Profile" subtitle="Update your photo" />
      <ToastHost />

      {!me || me.kind === "unknown" ? (
        <Card className="p-8 text-center text-gray-500">
          We couldn&apos;t find a staff, student or parent record linked to your
          login. Ask an administrator to check your account.
        </Card>
      ) : me.kind === "parent" ? (
        <Card className="p-8 text-center text-gray-500">
          <p className="font-semibold text-[#0F2A47] mb-1">{me.full_name}</p>
          <p className="text-sm">
            Parent accounts don&apos;t have a profile photo here — you can upload
            or change each child&apos;s photo from{" "}
            <a href="/dashboard/my-children" className="text-[#0F2A47] font-medium hover:underline">My Children</a>.
          </p>
        </Card>
      ) : (
        <Card className="p-6 flex flex-col items-center gap-4">
          {me.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={me.photo_url}
              alt={me.full_name}
              className="h-32 w-32 rounded-full object-cover border-4 border-[#C9A227]"
            />
          ) : (
            <div className="h-32 w-32 rounded-full flex items-center justify-center text-3xl font-bold text-white bg-gradient-to-br from-[#0F2A47] to-[#C9A227]">
              {me.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
            </div>
          )}

          <div className="text-center">
            <p className="font-bold text-[#0F2A47]">{me.full_name}</p>
            {me.subtitle && <p className="text-xs text-gray-500">{me.subtitle}</p>}
          </div>

          {me.kind === "student" && pendingReview ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-amber-600 font-medium">
              <Clock size={13} /> Photo pending review
            </span>
          ) : (
            <div className="flex gap-2">
              <label>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                />
                <span className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-[#0F2A47] text-white hover:bg-[#1B3E63] cursor-pointer">
                  {uploading ? "Uploading…" : (
                    <><Upload size={14} /> {me.photo_url ? "Change photo" : "Upload photo"}</>
                  )}
                </span>
              </label>
              <Button type="button" variant="secondary" onClick={() => setSelfieOpen(true)} disabled={uploading}>
                <Camera size={14} /> Take a selfie
              </Button>
            </div>
          )}

          <p className="text-[11px] text-gray-400 text-center">
            {me.kind === "student"
              ? "Use a clear, front-facing photo — an administrator reviews it before it appears on your ID card."
              : "Use a clear, front-facing photo — this appears on your staff ID card and payslip."}
          </p>
        </Card>
      )}

      <SelfieCapture
        open={selfieOpen}
        onClose={() => setSelfieOpen(false)}
        onCapture={handleFile}
        fileName={`${me?.kind ?? "profile"}-selfie.jpg`}
      />
    </div>
  );
}
