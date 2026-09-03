"use client";

/**
 * SelfieCapture
 *
 * A small camera-capture modal that lets the user take a photo with
 * their device camera instead of picking a file, for any photo upload
 * spot in the app (My Profile, staff form, student form, My Children).
 * Captures a single frame to a canvas and hands back a File with the
 * same shape a <input type="file"> change event would produce, so
 * every existing handleFile(file: File) callback works unchanged.
 *
 * Gracefully does nothing but show an error if the browser/device has
 * no camera or the user denies permission -- the regular file-picker
 * button next to it always still works as a fallback.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Camera, RotateCcw, Check } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
  /** Used to name the resulting file, e.g. "staff-selfie.jpg". */
  fileName?: string;
}

export function SelfieCapture({ open, onClose, onCapture, fileName = "selfie.jpg" }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) { stopStream(); setSnapshot(null); setError(null); setReady(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 640 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setReady(true);
      } catch {
        if (!cancelled) setError("Could not access your camera. Check your browser's camera permission, or use Upload photo instead.");
      }
    })();
    return () => { cancelled = true; stopStream(); };
  }, [open, stopStream]);

  function capture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const size = Math.min(video.videoWidth, video.videoHeight);
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Center-crop to a square and mirror it so the preview matches what
    // the user saw of themselves in the live video feed.
    const sx = (video.videoWidth - size) / 2;
    const sy = (video.videoHeight - size) / 2;
    ctx.translate(size, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);
    setSnapshot(canvas.toDataURL("image/jpeg", 0.92));
  }

  function retake() {
    setSnapshot(null);
  }

  function confirm() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], fileName, { type: "image/jpeg" });
      onCapture(file);
      onClose();
    }, "image/jpeg", 0.92);
  }

  return (
    <Modal open={open} onClose={onClose} title="Take a selfie" size="sm">
      <div className="space-y-3">
        {error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : (
          <div className="relative rounded-xl overflow-hidden bg-gray-900 aspect-square">
            <video
              ref={videoRef}
              muted
              playsInline
              className="w-full h-full object-cover -scale-x-100"
              style={{ display: snapshot ? "none" : "block" }}
            />
            {snapshot && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={snapshot} alt="Captured selfie preview" className="w-full h-full object-cover" />
            )}
            {!ready && !snapshot && (
              <div className="absolute inset-0 flex items-center justify-center text-white/60 text-xs">
                Starting camera…
              </div>
            )}
          </div>
        )}
        <canvas ref={canvasRef} className="hidden" />

        <div className="flex gap-2">
          {!error && (
            snapshot ? (
              <>
                <Button type="button" size="sm" variant="secondary" onClick={retake} className="flex-1">
                  <RotateCcw size={14} /> Retake
                </Button>
                <Button type="button" size="sm" onClick={confirm} className="flex-1">
                  <Check size={14} /> Use this photo
                </Button>
              </>
            ) : (
              <Button type="button" size="sm" onClick={capture} disabled={!ready} className="flex-1">
                <Camera size={14} /> Capture
              </Button>
            )
          )}
        </div>
      </div>
    </Modal>
  );
}
