"use client";

/**
 * Uploads a file into the public website-media bucket via
 * /api/storage/upload, which does the actual Storage write server-side
 * with the service-role key after checking the caller is an org admin.
 *
 * This used to call supabase.storage.from("website-media").upload(...)
 * directly from the browser -- the same call shape that started
 * failing for profile photos and letter signatures with a 503
 * DatabaseInvalidObjectDefinition / "The database schema is invalid or
 * incompatible." straight from Supabase's own Storage API. Fixed
 * proactively here before it got reported broken for Website Studio
 * too -- see src/app/api/storage/upload/route.ts.
 *
 * `pathPrefix` is optional and namespaces the *storage path* itself
 * (previously the logo upload used "logo-<ts>-<name>" vs. the media
 * library's plain "<ts>-<name>") -- it is NOT the media library's
 * "folder" dropdown, which is just a tag stored in the website_media
 * row and was never part of the storage path.
 */
export async function uploadWebsiteMedia(file: File, pathPrefix?: string): Promise<{ url: string; path: string }> {
  const form = new FormData();
  form.append("file", file);
  form.append("bucket", "website-media");
  if (pathPrefix) form.append("folder", pathPrefix);

  const res = await fetch("/api/storage/upload", { method: "POST", body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || "Upload failed.");

  return { url: body.url as string, path: body.path as string };
}
