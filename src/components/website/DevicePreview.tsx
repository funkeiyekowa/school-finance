"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import {
  Monitor, Tablet, Smartphone, X, RotateCw, RefreshCw, ExternalLink,
} from "lucide-react";

interface DevicePreviewProps {
  previewUrl: string;
  onClose: () => void;
  /** Shown in the toolbar so it is obvious whether this is draft or live. */
  label?: string;
  /** Draft previews get a gold badge and no "open in new tab" link. */
  isDraft?: boolean;
}

const DEVICES = [
  { id: "desktop", label: "Desktop", width: 1280, height: 800, icon: Monitor },
  { id: "tablet", label: "Tablet", width: 768, height: 1024, icon: Tablet },
  { id: "phone", label: "Phone", width: 375, height: 667, icon: Smartphone },
] as const;

type DeviceId = (typeof DEVICES)[number]["id"];

export function DevicePreview({ previewUrl, onClose, label, isDraft }: DevicePreviewProps) {
  const [activeDevice, setActiveDevice] = useState<DeviceId>("desktop");
  const [landscape, setLandscape] = useState(false);
  /* Bumping this remounts the iframe, which is the only reliable way to
     force a reload across origins without touching contentWindow. */
  const [reloadKey, setReloadKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const device = DEVICES.find(d => d.id === activeDevice)!;
  const frameWidth = landscape && activeDevice !== "desktop" ? device.height : device.width;
  const frameHeight = landscape && activeDevice !== "desktop" ? device.width : device.height;

  const maxW = Math.min(frameWidth, typeof window !== "undefined" ? window.innerWidth - 80 : 1280);
  const maxH = typeof window !== "undefined" ? window.innerHeight - 150 : 800;
  const scale = Math.min(1, maxW / frameWidth, maxH / frameHeight);

  const refresh = useCallback(() => {
    // Same-origin draft previews listen for this and refetch in place.
    try {
      iframeRef.current?.contentWindow?.postMessage("refresh-draft-preview", "*");
    } catch {
      /* Cross-origin — fall through to the remount below. */
    }
    setReloadKey(k => k + 1);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center bg-black/85 backdrop-blur-sm">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 w-full">
        {/* Context badge */}
        <span
          className={cn(
            "px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider shrink-0",
            isDraft ? "bg-[#C9A227] text-[#0F2A47]" : "bg-green-500/20 text-green-300 border border-green-500/30"
          )}
        >
          {label ?? (isDraft ? "Draft" : "Live")}
        </span>

        <div className="flex items-center gap-1.5">
          {DEVICES.map(d => {
            const Icon = d.icon;
            return (
              <button
                key={d.id}
                onClick={() => setActiveDevice(d.id)}
                aria-pressed={activeDevice === d.id}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                  activeDevice === d.id
                    ? "bg-[#C9A227] text-[#0F2A47]"
                    : "bg-white/10 text-white/70 hover:bg-white/20"
                )}
              >
                <Icon size={14} />
                <span className="hidden sm:inline">{d.label}</span>
              </button>
            );
          })}

          <button
            onClick={() => setLandscape(l => !l)}
            disabled={activeDevice === "desktop"}
            aria-pressed={landscape}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
              activeDevice === "desktop"
                ? "bg-white/5 text-white/30 cursor-not-allowed"
                : landscape
                  ? "bg-[#C9A227] text-[#0F2A47]"
                  : "bg-white/10 text-white/70 hover:bg-white/20"
            )}
          >
            <RotateCw size={14} />
            <span className="hidden sm:inline">Rotate</span>
          </button>

          <button
            onClick={refresh}
            title="Reload preview"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-white/10 text-white/70 hover:bg-white/20 transition-colors"
          >
            <RefreshCw size={14} />
            <span className="hidden sm:inline">Reload</span>
          </button>
        </div>

        <div className="flex-1" />

        {!isDraft && (
          <a
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-white/10 text-white/70 hover:bg-white/20 transition-colors"
          >
            <ExternalLink size={14} />
            <span className="hidden sm:inline">New tab</span>
          </a>
        )}

        <Button size="sm" variant="secondary" onClick={onClose}>
          <X size={14} /> Close
        </Button>
      </div>

      {/* Device frame */}
      <div className="flex-1 flex flex-col items-center justify-center min-h-0 pb-4">
        <div
          className="bg-white rounded-xl shadow-2xl overflow-hidden transition-all duration-300 ease-in-out"
          style={{ width: frameWidth * scale, height: frameHeight * scale }}
        >
          <iframe
            key={reloadKey}
            ref={iframeRef}
            src={previewUrl}
            title={isDraft ? "Draft site preview" : "Live site preview"}
            sandbox="allow-same-origin allow-scripts allow-forms"
            className="border-0"
            style={{
              width: frameWidth,
              height: frameHeight,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          />
        </div>

        <p className="mt-3 text-xs text-white/60 font-mono">
          {frameWidth} × {frameHeight}px
          {scale < 1 && ` (scaled ${Math.round(scale * 100)}%)`}
        </p>
      </div>
    </div>
  );
}
