"use client";

/**
 * Command Palette — ⌘K / Ctrl+K global search + navigation. Bold
 * modern take: gradient header, keyboard-first, recent items pinned.
 *
 * Mounted once in AppShell. Feeds itself from NAV_GROUPS so any nav
 * item is instantly reachable by name; also accepts adhoc "actions"
 * a page can register (though we start with nav-only for simplicity).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Command, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  section?: string;
  icon?: React.ReactNode;
  keywords?: string;                     // hidden keywords for matching
  onSelect: () => void;
}

export function CommandPalette({ items }: { items: CommandItem[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setCursor(0);
  }, []);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape" && open) close();
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, close]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((i) => {
      const hay = `${i.label} ${i.hint ?? ""} ${i.section ?? ""} ${i.keywords ?? ""}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [items, q]);

  useEffect(() => setCursor(0), [q]);
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLButtonElement>(`[data-cmd-idx="${cursor}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor, open]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, filtered.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[cursor];
      if (item) { item.onSelect(); close(); }
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-start justify-center pt-[10vh] px-4 bg-black/40 backdrop-blur-sm"
      onClick={close}
    >
      <div
        className="w-full max-w-xl bg-white rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-[#0F2A47] to-[#1B3E63]">
          <Search size={16} className="text-[#F4E9C7]" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search modules, actions, students..."
            className="flex-1 bg-transparent text-white placeholder:text-white/50 text-sm focus:outline-none"
          />
          <span className="hidden md:inline-flex items-center gap-1 text-[10px] text-white/60 border border-white/20 rounded px-1.5 py-0.5">
            <Command size={10} /> K
          </span>
        </div>
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1.5">
          {filtered.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-8">No matches. Try another word.</p>
          )}
          {filtered.map((item, i) => (
            <button
              key={item.id}
              data-cmd-idx={i}
              onClick={() => { item.onSelect(); close(); }}
              onMouseEnter={() => setCursor(i)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-2 text-sm text-left transition-colors",
                i === cursor ? "bg-[#F4E9C7]" : "hover:bg-gray-50"
              )}
            >
              <span className={cn("shrink-0", i === cursor ? "text-[#0F2A47]" : "text-gray-400")}>{item.icon ?? <ArrowRight size={14} />}</span>
              <span className="flex-1 min-w-0">
                <span className="text-[#0F2A47] font-medium truncate block">{item.label}</span>
                {item.hint && <span className="text-[11px] text-gray-500 truncate block">{item.hint}</span>}
              </span>
              {item.section && (
                <span className={cn("text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded",
                  i === cursor ? "bg-white text-[#0F2A47]" : "bg-gray-100 text-gray-500"
                )}>{item.section}</span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100 bg-gray-50 text-[10px] text-gray-500">
          <span>↑ ↓ to navigate · ↵ to select · esc to close</span>
        </div>
      </div>
    </div>
  );
}

/** Hook to wire the palette in AppShell — auto-builds items from NAV_GROUPS-like input. */
export function useNavCommandItems(groups: { label: string; items: { href: string; label: string; icon?: React.ReactNode }[] }[]): CommandItem[] {
  const router = useRouter();
  return useMemo(() => {
    const items: CommandItem[] = [];
    for (const group of groups) {
      for (const it of group.items) {
        items.push({
          id: it.href,
          label: it.label,
          hint: `Go to ${it.label}`,
          section: group.label || undefined,
          icon: it.icon,
          keywords: `${group.label} ${it.label} ${it.href}`,
          onSelect: () => router.push(it.href),
        });
      }
    }
    return items;
  }, [groups, router]);
}
