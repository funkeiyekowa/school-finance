"use client";

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
 * Compresses + uploads a profile photo via /api/photos/upload, returning
 * the public URL ready to store in students.photo_url / staff_members.photo_url.
 *
 * This used to call supabase.storage.from(BUCKET).upload(...) directly
 * from the browser. That started failing for every role (staff, student,
 * parent) with a 503 "DatabaseInvalidObjectDefinition" /
 * "The database schema is invalid or incompatible." straight from
 * Supabase's own Storage API -- confirmed via the browser Network tab,
 * and confirmed (via direct SQL) that it wasn't our bucket, RLS
 * policies, or storage.objects schema; the failure is in Supabase's
 * authenticated Storage REST path itself, before our policies are even
 * evaluated. Routing the actual write through our own server (which
 * uploads with the service-role key, same pattern already used by
 * src/app/api/email-webhook) sidesteps that broken path entirely, while
 * the API route re-checks authorization server-side (own staff record /
 * own student record / own linked child / in-org for staff-admin) so
 * this is not a permission downgrade -- see src/app/api/photos/upload/route.ts.
 */
export async function uploadProfilePhoto(
  orgId: string,
  kind: "students" | "staff",
  entityId: string,
  file: File
): Promise<string> {
  const compressed = await compressImage(file);

  const form = new FormData();
  form.append("file", new File([compressed], "photo.jpg", { type: "image/jpeg" }));
  form.append("kind", kind);
  form.append("entityId", entityId);

  const res = await fetch("/api/photos/upload", { method: "POST", body: form });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(body?.error || "Photo upload failed.");
  }

  return body.url as string;
}

/**
 * Compresses + uploads a letter signature image via /api/photos/upload
 * (kind "signatures"), returning the public URL to store in
 * letter_signatures.image_url. Same server-mediated path as
 * uploadProfilePhoto and for the same reason -- signatures used the
 * exact same direct-to-Storage call and hit the identical
 * DatabaseInvalidObjectDefinition error. Org-admin-only server-side
 * (see authorizeTarget in the route); no entityId, since a signature
 * isn't tied to a staff/student record.
 */
export async function uploadSignatureImage(file: File): Promise<string> {
  const compressed = await compressImage(file, 320, 0.9);

  const form = new FormData();
  form.append("file", new File([compressed], "signature.jpg", { type: "image/jpeg" }));
  form.append("kind", "signatures");

  const res = await fetch("/api/photos/upload", { method: "POST", body: form });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(body?.error || "Signature upload failed.");
  }

  return body.url as string;
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

/** Natural sort so "img2.jpg" sorts before "img10.jpg" -- important for
 *  photo-day batches where files are numbered in capture order. */
export function naturalSort(a: File, b: File): number {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
}
