"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { Monitor, Tablet, Smartphone, X, RotateCw } from "lucide-react";

interface DevicePreviewProps {
  previewUrl: string;
  onClose: () => void;
}

const DEVICES = [
  { id: "desktop", label: "Desktop", width: 1280, height: 800, icon: Monitor },
  { id: "tablet", label: "Tablet", width: 768, height: 1024, icon: Tablet },
  { id: "phone", label: "Phone", width: 375, height: 667, icon: Smartphone },
] as const;

type DeviceId = (typeof DEVICES)[number]["id"];

export function DevicePreview({ previewUrl, onClose }: DevicePreviewProps) {
  const [activeDevice, setActiveDevice] = useState<DeviceId>("desktop");
  const [landscape, setLandscape] = useState(false);

  const device = DEVICES.find(d => d.id === activeDevice)!;
  const frameWidth = landscape && activeDevice !== "desktop" ? device.height : device.width;
  const frameHeight = landscape && activeDevice !== "desktop" ? device.width : device.height;

  const maxW = Math.min(frameWidth, typeof window !== "undefined" ? window.innerWidth - 80 : 1280);
  const maxH = typeof window !== "undefined" ? window.innerHeight - 140 : 800;
  const scale = Math.min(1, maxW / frameWidth, maxH / frameHeight);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center bg-black/80 backdrop-blur-sm">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-3 w-full max-w-3xl justify-center">
        {DEVICES.map(d => {
          const Icon = d.icon;
          return (
            <button
              key={d.id}
              onClick={() => setActiveDevice(d.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                activeDevice === d.id
                  ? "bg-[#C9A227] text-white"
                  : "bg-white/10 text-white/70 hover:bg-white/20"
              )}
            >
              <Icon size={14} /> {d.label}
            </button>
          );
        })}

        <button
          onClick={() => setLandscape(l => !l)}
          disabled={activeDevice === "desktop"}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
            activeDevice === "desktop"
              ? "bg-white/5 text-white/30 cursor-not-allowed"
              : landscape
                ? "bg-[#C9A227] text-white"
                : "bg-white/10 text-white/70 hover:bg-white/20"
          )}
        >
          <RotateCw size={14} /> Rotate
        </button>

        <div className="flex-1" />

        <Button size="sm" variant="secondary" onClick={onClose}>
          <X size={14} /> Close
        </Button>
      </div>

      {/* Device frame */}
      <div className="flex-1 flex flex-col items-center justify-center">
        <div
          className="bg-white rounded-xl shadow-2xl overflow-hidden transition-all duration-300 ease-in-out"
          style={{
            width: frameWidth * scale,
            height: frameHeight * scale,
          }}
        >
          <iframe
            src={previewUrl}
            title="Site preview"
            sandbox="allow-same-origin allow-scripts"
            className="w-full h-full border-0"
            style={{
              width: frameWidth,
              height: frameHeight,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          />
        </div>

        {/* Width label */}
        <p className="mt-3 text-xs text-white/60 font-mono">
          {frameWidth} × {frameHeight}px
          {scale < 1 && ` (scaled ${Math.round(scale * 100)}%)`}
        </p>
      </div>
    </div>
  );
}
