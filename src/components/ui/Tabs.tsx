"use client";

import { cn } from "@/lib/utils";

/**
 * Bold, modern tab component with pill-underline animation and count
 * chips. Replaces the copy-pasted tab-bar JSX in every dashboard page.
 *
 * Usage:
 *   const TABS: TabDef<MyTab>[] = [{ key: "visits", label: "Visits", icon: <Stethoscope size={14}/>, count: stats.visits_today }];
 *   <Tabs tabs={TABS} value={tab} onChange={setTab} />
 */
export interface TabDef<T extends string> {
  key: T;
  label: string;
  icon?: React.ReactNode;
  count?: number;
  hidden?: boolean;
  emphasis?: "default" | "danger" | "success";
}

interface TabsProps<T extends string> {
  tabs: TabDef<T>[];
  value: T;
  onChange: (next: T) => void;
  variant?: "underline" | "pill";
  className?: string;
}

export function Tabs<T extends string>({ tabs, value, onChange, variant = "underline", className }: TabsProps<T>) {
  const visible = tabs.filter((t) => !t.hidden);

  if (variant === "pill") {
    return (
      <div className={cn("inline-flex gap-1 p-1 bg-gray-100 rounded-xl", className)}>
        {visible.map((t) => (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all",
              value === t.key
                ? "bg-white text-[#0F2A47] shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            )}
          >
            {t.icon}
            {t.label}
            {typeof t.count === "number" && t.count > 0 && (
              <CountChip value={t.count} emphasis={t.emphasis} active={value === t.key} />
            )}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className={cn("flex gap-1 border-b border-gray-200 overflow-x-auto", className)}>
      {visible.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            "group relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
            value === t.key
              ? "border-[#C9A227] text-[#0F2A47]"
              : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
          )}
        >
          {t.icon}
          {t.label}
          {typeof t.count === "number" && t.count > 0 && (
            <CountChip value={t.count} emphasis={t.emphasis} active={value === t.key} />
          )}
        </button>
      ))}
    </div>
  );
}

function CountChip({ value, emphasis, active }: { value: number; emphasis?: TabDef<string>["emphasis"]; active: boolean }) {
  const cls =
    emphasis === "danger"
      ? "bg-red-100 text-red-700"
      : emphasis === "success"
      ? "bg-emerald-100 text-emerald-700"
      : active
      ? "bg-[#F4E9C7] text-[#0F2A47]"
      : "bg-gray-100 text-gray-600";
  return (
    <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center", cls)}>
      {value > 99 ? "99+" : value}
    </span>
  );
}
