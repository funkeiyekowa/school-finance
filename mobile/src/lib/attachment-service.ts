import { Image } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "@/lib/supabase";

const BUCKET = "message-attachments";

/**
 * Message attachments — mobile side.
 *
 * Uploading goes through the same server-mediated route the web app uses
 * (/api/storage/upload), for the same reason documented there: a direct
 * browser/client -> Supabase Storage upload for this bucket has previously
 * failed with a 503 from Supabase's own Storage API, before RLS is even
 * evaluated. The web app authenticates that route with its session cookie;
 * mobile has no cookie, so the route was extended (server-side, additive
 * only) to also accept `Authorization: Bearer <access_token>`, verified
 * independently via the service-role client — never trusted from the
 * request body. See the route's own comment for the exact mechanism.
 *
 * Reading an attachment back does NOT need the route: createSignedUrl()
 * uses this client's own session the same way on every platform, so mobile
 * calls it directly, exactly like the web app does.
 */

export interface PickedAttachment {
  uri: string;
  name: string;
  mimeType: string;
  size: number | null;
}

export interface UploadedAttachment {
  storage_path: string;
  file_name: string;
  file_type: string;
  file_size_bytes: number;
  width?: number;
  height?: number;
}

/** Opens the photo library. Returns null if the user cancels or denies permission. */
export async function pickImageAttachment(): Promise<PickedAttachment | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 0.85,
    allowsMultipleSelection: false,
  });
  if (result.canceled || result.assets.length === 0) return null;

  const asset = result.assets[0];
  return {
    uri: asset.uri,
    name: asset.fileName || `photo-${Date.now()}.jpg`,
    mimeType: asset.mimeType || "image/jpeg",
    size: asset.fileSize ?? null,
  };
}

/** Opens the system document picker for any file type. */
export async function pickDocumentAttachment(): Promise<PickedAttachment | null> {
  const result = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true });
  if (result.canceled || result.assets.length === 0) return null;

  const asset = result.assets[0];
  return {
    uri: asset.uri,
    name: asset.name,
    mimeType: asset.mimeType || "application/octet-stream",
    size: asset.size ?? null,
  };
}

/**
 * Uploads one picked file via /api/storage/upload, exactly mirroring
 * uploadMessageAttachment() on web. Reads maxAttachmentMb /
 * allowedAttachmentTypes from messaging_policy the same way the web
 * Composer does, so the same limits apply on both platforms -- this is a
 * client-side courtesy check; the route enforces its own backstop limits
 * regardless of what this function does.
 */
export async function uploadAttachment(
  conversationId: string,
  file: PickedAttachment,
  limits: { maxAttachmentMb: number; allowedTypes: string[] },
): Promise<UploadedAttachment> {
  if (file.size != null && file.size > limits.maxAttachmentMb * 1024 * 1024) {
    throw new Error(`${file.name} is over the ${limits.maxAttachmentMb}MB limit`);
  }
  if (limits.allowedTypes.length > 0 && !limits.allowedTypes.includes(file.mimeType)) {
    throw new Error(`${file.name} is not an allowed file type`);
  }

  const base = process.env.EXPO_PUBLIC_WEB_APP_URL;
  if (!base) throw new Error("Attachments are not configured on this build.");

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("You are signed out — attachments could not be sent.");

  const form = new FormData();
  // React Native's fetch/FormData accepts { uri, name, type } in place of a
  // browser File/Blob -- this is the standard Expo upload shape.
  form.append("file", { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
  form.append("bucket", BUCKET);
  form.append("conversationId", conversationId);

  const res = await fetch(`${base.replace(/\/$/, "")}/api/storage/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || "Attachment upload failed.");

  let width: number | undefined;
  let height: number | undefined;
  if (file.mimeType.startsWith("image/")) {
    try {
      const dims = await readImageDimensions(file.uri);
      width = dims.width;
      height = dims.height;
    } catch {
      // Non-fatal — matches the web helper's behaviour.
    }
  }

  return {
    storage_path: body.path as string,
    file_name: file.name,
    file_type: file.mimeType,
    file_size_bytes: file.size ?? 0,
    width,
    height,
  };
}

function readImageDimensions(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      (err) => reject(err),
    );
  });
}

/** Signed URL to view/download an attachment. Mirrors the web helper exactly. */
export async function getAttachmentSignedUrl(path: string, expiresInSeconds = 3600): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
