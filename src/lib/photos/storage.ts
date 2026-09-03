"use client";

import { createClient } from "@/lib/supabase/client";

const BUCKET = "profile-photos";

/**
 * Downscales + re-encodes an image client-side before upload so a
 * multi-MB phone photo never reaches Supabase Storage as-is. Free-tier
 * storage math: 1,000 students at full phone-camera size (4-8MB each)
 * is several GB; at ~480px/JPEG-0.82 each lands around 40-80KB, so the
 * same 1,000 photos comfortably fit in tens of MB.
 */
export function compressImage(file: File, maxDim = 480, quality = 0.82): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas not supported"));
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode image"))),
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read image file")); };
    img.src = url;
  });
}

/**
 * Compresses + uploads a profile photo to the public profile-photos
 * bucket at <organization_id>/<kind>/<entityId>/<uuid>.jpg, matching
 * the bucket's storage RLS (org-prefix write, public read -- see
 * supabase/photo_uploads_module.sql). Returns the public URL, ready to
 * store directly in students.photo_url / staff_members.photo_url.
 */
export async function uploadProfilePhoto(
  orgId: string,
  kind: "students" | "staff",
  entityId: string,
  file: File
): Promise<string> {
  const supabase = createClient();
  const compressed = await compressImage(file);
  const path = `${orgId}/${kind}/${entityId}/${crypto.randomUUID()}.jpg`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, compressed, {
    contentType: "image/jpeg",
    upsert: false,
  });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

/** Natural sort so "img2.jpg" sorts before "img10.jpg" -- important for
 *  photo-day batches where files are numbered in capture order. */
export function naturalSort(a: File, b: File): number {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
}
