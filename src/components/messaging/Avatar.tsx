"use client";

import { cn } from "@/lib/utils";

/**
 * Initials avatar. The platform has no avatar/photo storage for
 * profiles/students/staff (confirmed during the communication-module
 * audit), so every person in the chat UI is represented by a colored
 * initials medallion instead of a photo, exactly like most SIS chat
 * products default to before schools upload staff photos.
 */
const PALETTE = [
  "#0F2A47", "#C9A227", "#1B6E4F", "#7C3AED", "#BE123C", "#0E7490", "#B45309", "#4338CA",
];

function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface AvatarProps {
  name: string;
  seed?: string;
  size?: number;
  imageUrl?: string | null;
  className?: string;
  ring?: boolean;
}

export function Avatar({ name, seed, size = 40, imageUrl, className, ring }: AvatarProps) {
  const bg = colorFor(seed ?? name ?? "?");
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={name}
        width={size}
        height={size}
        className={cn("rounded-full object-cover flex-shrink-0", ring && "ring-2 ring-white", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className={cn(
        "rounded-full flex items-center justify-center flex-shrink-0 font-semibold text-white select-none",
        ring && "ring-2 ring-white",
        className
      )}
      style={{ width: size, height: size, backgroundColor: bg, fontSize: Math.max(11, size * 0.38) }}
      aria-hidden
    >
      {initialsFor(name)}
    </div>
  );
}

/** Small green/gray presence dot, absolutely positioned over an Avatar's corner. */
export function PresenceDot({ online }: { online: boolean }) {
  return (
    <span
      className={cn(
        "absolute bottom-0 right-0 block rounded-full ring-2 ring-white",
        online ? "bg-emerald-500" : "bg-gray-300"
      )}
      style={{ width: 10, height: 10 }}
    />
  );
}
