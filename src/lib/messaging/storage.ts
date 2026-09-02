"use client";

import { createClient } from "@/lib/supabase/client";

const BUCKET = "message-attachments";

export interface UploadedAttachment {
  storage_path: string;
  file_name: string;
  file_type: string;
  file_size_bytes: number;
  width?: number;
  height?: number;
}

/**
 * Uploads one file into the private message-attachments bucket at
 * <organization_id>/<conversation_id>/<uuid>-<filename>, matching the
 * path shape the bucket's storage RLS policies check against
 * (see supabase/20260902180000_communication_module.sql, section 19).
 */
export async function uploadMessageAttachment(
  orgId: string, conversationId: string, file: File
): Promise<UploadedAttachment> {
  const supabase = createClient();
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${orgId}/${conversationId}/${crypto.randomUUID()}-${safeName}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) throw new Error(error.message);

  let width: number | undefined, height: number | undefined;
  if (file.type.startsWith("image/")) {
    try {
      const dims = await readImageDimensions(file);
      width = dims.width; height = dims.height;
    } catch { /* non-fatal */ }
  }

  return { storage_path: path, file_name: file.name, file_type: file.type || "application/octet-stream", file_size_bytes: file.size, width, height };
}

export async function getAttachmentSignedUrl(path: string, expiresInSeconds = 3600): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}

function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read image dimensions")); };
    img.src = url;
  });
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
