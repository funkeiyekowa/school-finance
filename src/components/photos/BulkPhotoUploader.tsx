"use client";

/**
 * Shared bulk photo uploader with a match-preview grid.
 *
 * The core problem this solves: a "photo day" produces a batch of files
 * in roughly the order they were taken, but nothing guarantees that
 * order matches the roster. Rather than trust filenames or manual
 * labeling (where mistakes actually happen), this shows every uploaded
 * photo lined up against a roster row with an explicit position number
 * the admin can change -- so a mismatch is caught by eye before saving,
 * not discovered on a printed ID card afterward.
 *
 * Used by both /dashboard/students/photos and /dashboard/staff/photos
 * (see those thin page wrappers) -- `roster` is pre-sorted by the
 * caller to match whatever order the printed class list / staff list
 * uses, and `onCommit` receives the final {id, photoUrl} pairs.
 */

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { uploadProfilePhoto, isImageFile, naturalSort } from "@/lib/photos/storage";
import { UploadCloud, X, Check, Loader2 } from "lucide-react";

export interface RosterPerson {
  id: string;
  name: string;
  subLabel?: string; // e.g. admission number / staff code
  currentPhotoUrl?: string | null;
}

interface Props {
  orgId: string;
  kind: "students" | "staff";
  roster: RosterPerson[];
  onCommit: (pairs: { id: string; photoUrl: string }[]) => Promise<void>;
  notify: (message: string, kind?: "success" | "error") => void;
}

interface StagedFile {
  file: File;
  previewUrl: string;
}

export function BulkPhotoUploader({ orgId, kind, roster, onCommit, notify }: Props) {
  const [files, setFiles] = useState<StagedFile[]>([]);
  const [assignments, setAssignments] = useState<Record<number, string>>({}); // file index -> roster person id
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const rosterById = useMemo(() => new Map(roster.map((r) => [r.id, r])), [roster]);

  function addFiles(list: FileList | File[]) {
    const arr = Array.from(list).filter(isImageFile).sort(naturalSort);
    if (arr.length === 0) {
      notify("No image files found in that selection.", "error");
      return;
    }
    const staged = arr.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }));
    setFiles(staged);

    // Default assignment: sequential, file[i] -> roster[i]. This is the
    // "photos captured in roster order" fast path -- admin only needs to
    // fix the rows that are actually wrong, not assign every row by hand.
    const defaults: Record<number, string> = {};
    staged.forEach((_, i) => {
      if (roster[i]) defaults[i] = roster[i].id;
    });
    setAssignments(defaults);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  }

  function clearAll() {
    files.forEach((f) => URL.revokeObjectURL(f.previewUrl));
    setFiles([]);
    setAssignments({});
  }

  function reassign(fileIndex: number, personId: string) {
    setAssignments((prev) => ({ ...prev, [fileIndex]: personId }));
  }

  function removeFile(fileIndex: number) {
    setFiles((prev) => prev.filter((_, i) => i !== fileIndex));
    setAssignments((prev) => {
      const next: Record<number, string> = {};
      Object.entries(prev).forEach(([k, v]) => {
        const idx = Number(k);
        if (idx < fileIndex) next[idx] = v;
        else if (idx > fileIndex) next[idx - 1] = v;
      });
      return next;
    });
  }

  // Guard against assigning the same person to two different photos --
  // the most likely real mistake once someone starts hand-fixing rows.
  const duplicatePersonIds = useMemo(() => {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    Object.values(assignments).forEach((id) => {
      if (seen.has(id)) dupes.add(id);
      seen.add(id);
    });
    return dupes;
  }, [assignments]);

  const assignedCount = Object.keys(assignments).length;
  const hasDuplicates = duplicatePersonIds.size > 0;

  async function commit() {
    if (assignedCount === 0) return;
    if (hasDuplicates) {
      notify("Two photos are assigned to the same person -- fix that before saving.", "error");
      return;
    }
    setUploading(true);
    setProgress(0);
    try {
      const entries = Object.entries(assignments);
      const pairs: { id: string; photoUrl: string }[] = [];
      for (let i = 0; i < entries.length; i++) {
        const [fileIndexStr, personId] = entries[i];
        const fileIndex = Number(fileIndexStr);
        const staged = files[fileIndex];
        if (!staged) continue;
        const photoUrl = await uploadProfilePhoto(orgId, kind, personId, staged.file);
        pairs.push({ id: personId, photoUrl });
        setProgress(Math.round(((i + 1) / entries.length) * 100));
      }
      await onCommit(pairs);
      notify(`Uploaded ${pairs.length} photo${pairs.length === 1 ? "" : "s"}.`);
      clearAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Bulk upload failed.", "error");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      {files.length === 0 ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
            dragOver ? "border-[#C9A227] bg-[#F4E9C7]/30" : "border-gray-300 bg-white"
          }`}
        >
          <UploadCloud className="mx-auto mb-3 text-gray-400" size={32} />
          <p className="text-sm font-medium text-gray-700">
            Drag photos here, or choose files
          </p>
          <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
            Name or number your files in the same order as your printed class
            list / roster (e.g. 01.jpg, 02.jpg…) for the best automatic match.
          </p>
          <label className="inline-block mt-4">
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && addFiles(e.target.files)}
            />
            <span className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-[#0F2A47] text-white hover:bg-[#1B3E63] cursor-pointer">
              Choose photos
            </span>
          </label>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">
              {files.length} photo{files.length === 1 ? "" : "s"} · {assignedCount} matched
              {hasDuplicates && (
                <span className="text-red-600 font-semibold"> · duplicate assignment — fix below</span>
              )}
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={clearAll} disabled={uploading}>
                Clear all
              </Button>
              <Button
                variant="gold"
                size="sm"
                onClick={commit}
                disabled={uploading || assignedCount === 0 || hasDuplicates}
              >
                {uploading ? (
                  <><Loader2 size={14} className="animate-spin" /> Uploading {progress}%</>
                ) : (
                  <><Check size={14} /> Save {assignedCount} photo{assignedCount === 1 ? "" : "s"}</>
                )}
              </Button>
            </div>
          </div>

          <Card className="overflow-hidden">
            <div className="max-h-[520px] overflow-y-auto divide-y divide-gray-100">
              {files.map((staged, fileIndex) => {
                const assignedId = assignments[fileIndex];
                const assignedPerson = assignedId ? rosterById.get(assignedId) : undefined;
                const isDup = assignedId ? duplicatePersonIds.has(assignedId) : false;
                return (
                  <div
                    key={fileIndex}
                    className={`flex items-center gap-3 p-3 ${isDup ? "bg-red-50" : ""}`}
                  >
                    <span className="text-xs text-gray-400 w-6 text-right shrink-0">{fileIndex + 1}</span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={staged.previewUrl}
                      alt=""
                      className="h-14 w-14 rounded-lg object-cover border border-gray-200 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-400 truncate">{staged.file.name}</p>
                      <select
                        value={assignedId ?? ""}
                        onChange={(e) => reassign(fileIndex, e.target.value)}
                        className={`mt-1 w-full px-2 py-1.5 border rounded text-sm ${
                          isDup ? "border-red-400" : "border-gray-300"
                        }`}
                      >
                        <option value="">— Not matched, skip —</option>
                        {roster.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}{r.subLabel ? ` (${r.subLabel})` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    {assignedPerson?.currentPhotoUrl && (
                      <span className="text-[10px] text-amber-600 shrink-0 max-w-[70px] text-center">
                        Replaces existing photo
                      </span>
                    )}
                    <button
                      onClick={() => removeFile(fileIndex)}
                      className="text-gray-400 hover:text-red-600 shrink-0"
                      title="Remove this photo from the batch"
                    >
                      <X size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
