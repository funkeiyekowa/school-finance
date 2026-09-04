/**
 * useExamRecording — browser-native camera + screen recording for CBT proctoring.
 *
 * Uses MediaRecorder (getUserMedia for camera, getDisplayMedia for screen),
 * chunked every ~10s, uploaded directly to Supabase Storage via signed URLs
 * (not through Vercel). Each chunk is registered in proctoring_recordings via
 * the register_proctoring_chunk RPC.
 *
 * On permission revocation or screen-share stop, fires the provided
 * onViolation callback so it goes through the same unified violation pipeline.
 */

import { useRef, useCallback, useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

const CHUNK_INTERVAL_MS = 10_000; // 10 seconds per chunk
const MIME_TYPE = "video/webm;codecs=vp9,opus";
const FALLBACK_MIME = "video/webm";

interface UseExamRecordingOpts {
  attemptId: string | null;
  cameraRequired: boolean;
  screenRequired: boolean;
  onViolation: (kind: string) => void;
}

interface RecordingState {
  cameraActive: boolean;
  screenActive: boolean;
  uploading: boolean;
  error: string | null;
}

function getSupportedMime(): string {
  if (typeof MediaRecorder !== "undefined") {
    if (MediaRecorder.isTypeSupported(MIME_TYPE)) return MIME_TYPE;
    if (MediaRecorder.isTypeSupported(FALLBACK_MIME)) return FALLBACK_MIME;
    if (MediaRecorder.isTypeSupported("video/mp4")) return "video/mp4";
  }
  return FALLBACK_MIME;
}

export function useExamRecording(opts: UseExamRecordingOpts) {
  const { attemptId, cameraRequired, screenRequired, onViolation } = opts;
  const supabase = createClient();

  const cameraRecorderRef = useRef<MediaRecorder | null>(null);
  const screenRecorderRef = useRef<MediaRecorder | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraChunkIdx = useRef(0);
  const screenChunkIdx = useRef(0);
  const uploadQueue = useRef<Promise<void>>(Promise.resolve());

  const [state, setState] = useState<RecordingState>({
    cameraActive: false,
    screenActive: false,
    uploading: false,
    error: null,
  });

  const uploadChunk = useCallback(async (blob: Blob, type: "camera" | "screen", idx: number) => {
    if (!attemptId || blob.size === 0) return;
    setState(s => ({ ...s, uploading: true }));

    try {
      // Get a signed upload URL from our API
      const urlRes = await fetch("/api/proctoring/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          attemptId,
          recordingType: type,
          chunkIndex: idx,
          contentType: blob.type || "video/webm",
        }),
      });
      if (!urlRes.ok) {
        const err = await urlRes.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `Upload URL failed: ${urlRes.status}`);
      }
      const { signedUrl, storagePath } = await urlRes.json() as { signedUrl: string; storagePath: string };

      // Upload directly to Supabase Storage (not through Vercel)
      const uploadRes = await fetch(signedUrl, {
        method: "PUT",
        headers: { "content-type": blob.type || "video/webm" },
        body: blob,
      });
      if (!uploadRes.ok) throw new Error(`Storage upload failed: ${uploadRes.status}`);

      // Register the chunk metadata in the DB
      await supabase.rpc("register_proctoring_chunk", {
        p_attempt: attemptId,
        p_recording_type: type,
        p_chunk_index: idx,
        p_storage_path: storagePath,
        p_size_bytes: blob.size,
        p_duration_ms: CHUNK_INTERVAL_MS,
      });
    } catch (err) {
      console.error(`Proctoring chunk upload failed (${type} #${idx}):`, err);
      // Don't crash the exam — log the error and continue recording
    } finally {
      setState(s => ({ ...s, uploading: false }));
    }
  }, [attemptId, supabase]);

  const enqueueUpload = useCallback((blob: Blob, type: "camera" | "screen", idx: number) => {
    // Serialize uploads to prevent parallel storms
    uploadQueue.current = uploadQueue.current.then(() => uploadChunk(blob, type, idx));
  }, [uploadChunk]);

  const startRecorder = useCallback((stream: MediaStream, type: "camera" | "screen") => {
    const mime = getSupportedMime();
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    const chunkRef = type === "camera" ? cameraChunkIdx : screenChunkIdx;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        const idx = chunkRef.current++;
        enqueueUpload(e.data, type, idx);
      }
    };

    recorder.onerror = () => {
      setState(s => ({
        ...s,
        [type === "camera" ? "cameraActive" : "screenActive"]: false,
        error: `${type} recording error`,
      }));
    };

    recorder.start(CHUNK_INTERVAL_MS);
    return recorder;
  }, [enqueueUpload]);

  const startCamera = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: true,
      });
      cameraStreamRef.current = stream;
      cameraRecorderRef.current = startRecorder(stream, "camera");
      setState(s => ({ ...s, cameraActive: true, error: null }));

      // Monitor track end (permission revoked)
      for (const track of stream.getTracks()) {
        track.onended = () => {
          setState(s => ({ ...s, cameraActive: false }));
          onViolation("camera permission revoked");
        };
      }
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Camera access denied";
      setState(s => ({ ...s, error: msg }));
      return false;
    }
  }, [startRecorder, onViolation]);

  const startScreen = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "monitor" } as MediaTrackConstraints,
        audio: false,
      });
      screenStreamRef.current = stream;
      screenRecorderRef.current = startRecorder(stream, "screen");
      setState(s => ({ ...s, screenActive: true, error: null }));

      // Monitor track end (student stops sharing) — this is a violation
      for (const track of stream.getVideoTracks()) {
        track.onended = () => {
          setState(s => ({ ...s, screenActive: false }));
          onViolation("screen share stopped");
        };
      }
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Screen share denied";
      setState(s => ({ ...s, error: msg }));
      return false;
    }
  }, [startRecorder, onViolation]);

  const stopAll = useCallback(() => {
    for (const ref of [cameraRecorderRef, screenRecorderRef]) {
      try { ref.current?.stop(); } catch { /* ignore */ }
      ref.current = null;
    }
    for (const ref of [cameraStreamRef, screenStreamRef]) {
      try { ref.current?.getTracks().forEach(t => t.stop()); } catch { /* ignore */ }
      ref.current = null;
    }
    setState(s => ({ ...s, cameraActive: false, screenActive: false }));
  }, []);

  // Cleanup on unmount
  useEffect(() => () => stopAll(), [stopAll]);

  return {
    ...state,
    startCamera,
    startScreen,
    stopAll,
  };
}
