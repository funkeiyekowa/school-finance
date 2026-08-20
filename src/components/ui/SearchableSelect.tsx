"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Search, ChevronDown, X } from "lucide-react";

interface Option {
  value: string;
  label: string;
  sublabel?: string;
}

interface SearchableSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  className?: string;
}

export function SearchableSelect({
  options, value, onChange, placeholder = "Search…", label, disabled, className,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedOption = options.find(o => o.value === value);

  const filtered = query.trim()
    ? options.filter(o =>
        o.label.toLowerCase().includes(query.toLowerCase()) ||
        o.value.toLowerCase().includes(query.toLowerCase()) ||
        (o.sublabel?.toLowerCase().includes(query.toLowerCase()) ?? false)
      )
    : options;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  return (
    <div className={cn("space-y-1", className)} ref={containerRef}>
      {label && <label className="block text-sm font-medium text-gray-700">{label}</label>}
      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => { setOpen(!open); setQuery(""); }}
          className={cn(
            "w-full flex items-center justify-between px-3 py-2.5 border rounded-lg text-sm bg-white text-left transition-colors",
            "focus:outline-none focus:ring-2 focus:ring-[#C9A227] focus:border-transparent",
            "border-gray-300 hover:border-gray-400",
            disabled && "opacity-60 cursor-not-allowed"
          )}
        >
          <span className={cn(!selectedOption && "text-gray-400")}>
            {selectedOption ? (
              <span className="flex items-center gap-2">
                <span className="font-medium">{selectedOption.label}</span>
                {selectedOption.sublabel && (
                  <span className="text-gray-400 text-xs">{selectedOption.sublabel}</span>
                )}
              </span>
            ) : placeholder}
          </span>
          <span className="flex items-center gap-1 shrink-0 ml-2">
            {value && (
              <span
                role="button"
                tabIndex={0}
                onClick={e => { e.stopPropagation(); onChange(""); }}
                onKeyDown={e => e.key === "Enter" && onChange("")}
                className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
              >
                <X size={12} />
              </span>
            )}
            <ChevronDown size={14} className={cn("text-gray-400 transition-transform", open && "rotate-180")} />
          </span>
        </button>

        {open && (
          <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2">
              <Search size={14} className="text-gray-400 shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Type to search…"
                className="flex-1 text-sm outline-none bg-transparent"
              />
            </div>
            <div className="max-h-48 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="px-3 py-3 text-sm text-gray-400 text-center">No results found</div>
              ) : (
                filtered.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => { onChange(opt.value); setOpen(false); setQuery(""); }}
                    className={cn(
                      "w-full text-left px-3 py-2.5 text-sm hover:bg-[#F7F5F0] transition-colors flex flex-col",
                      value === opt.value && "bg-[#F4E9C7] font-medium"
                    )}
                  >
                    <span className="text-gray-900">{opt.label}</span>
                    {opt.sublabel && <span className="text-gray-400 text-xs">{opt.sublabel}</span>}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
